import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JobSource } from '../generated/prisma/enums.js';
import { type AppConfig, setting } from '../config/app-config.js';
import { HttpClient } from '../common/http/http-client.js';
import { HttpError, isHostBlockedError } from '../common/http/errors.js';
import { JobStoreService } from './job-store.service.js';
import { prepareBatch } from './pipeline/filter.js';
import { parseLinkedInSearch } from './sources/linkedin.parser.js';
import type { RawJob } from './sources/source.types.js';
import { COMPANY_BLOCKLIST, LINKEDIN_SEARCHES, type LinkedInSearch } from './sources.config.js';

// LinkedIn lane (docs/ARCHITECTURE.md §3.10): logged-out job search by city, one request at a
// time (the HTTP client spaces LinkedIn calls 2–5 s apart), within a daily request budget.
// Never uses cookies, accounts, proxies or anything that gets around a block.

const MAX_JOBS_PER_SEARCH = 1000; // LinkedIn stops returning results around here
const FLUSH_EVERY = 100;
const SEARCH_URL = 'https://www.linkedin.com/jobs-guest/jobs/api/seeMoreJobPostings/search';

export type LinkedInStats = {
  enabled: boolean;
  requests: number;
  cards: number;
  new: number;
  /** Searches that reached ~1,000 results: split them (e.g. by work type) in sources.config.ts. */
  saturated: string[];
  /** LinkedIn refused us (rate limit or bot check); the lane stopped for the day. */
  blocked: boolean;
  errors: number;
};

export function disabledLinkedInStats(): LinkedInStats {
  return {
    enabled: false,
    requests: 0,
    cards: 0,
    new: 0,
    saturated: [],
    blocked: false,
    errors: 0,
  };
}

/** First-pass page share per search: the budget split evenly, at least one page each. */
export function firstPassShare(budget: number, searches: number): number {
  return searches === 0 ? 0 : Math.max(1, Math.floor(budget / searches));
}

export function searchUrl(location: string, windowSeconds: number, start: number): string {
  const params = new URLSearchParams({
    keywords: '',
    location,
    f_TPR: `r${windowSeconds}`,
    start: String(start),
  });
  return `${SEARCH_URL}?${params.toString()}`;
}

type SearchState = { search: LinkedInSearch; start: number; done: boolean; buffer: RawJob[] };

@Injectable()
export class LinkedInLaneService {
  private readonly logger = new Logger(LinkedInLaneService.name);
  private readonly config: AppConfig;

  constructor(
    private readonly http: HttpClient,
    private readonly store: JobStoreService,
    config: ConfigService,
  ) {
    this.config = config as unknown as AppConfig;
  }

  async run(opts: {
    now: Date;
    deadline: Date;
    windowSeconds: number;
    /** Override for tests; defaults to LINKEDIN_SEARCHES. */
    searches?: readonly LinkedInSearch[];
  }): Promise<LinkedInStats> {
    if (!setting(this.config, 'LINKEDIN_ENABLED')) return disabledLinkedInStats();

    const stats: LinkedInStats = { ...disabledLinkedInStats(), enabled: true };
    const targets = new Set<string>(setting(this.config, 'TARGET_COUNTRIES'));
    const budget = setting(this.config, 'LINKEDIN_MAX_REQUESTS');
    const states: SearchState[] = [...(opts.searches ?? LINKEDIN_SEARCHES)]
      .filter((s) => targets.has(s.country))
      .sort((a, b) => a.priority - b.priority) // stable: config order breaks ties
      .map((search) => ({ search, start: 0, done: false, buffer: [] }));
    const seen = new Set<string>(); // the same posting often shows up in two city searches

    const canContinue = () =>
      !stats.blocked && stats.requests < budget && Date.now() < opts.deadline.getTime();

    // Pass 1: every city gets its fair share. Pass 2: leftover budget, in priority order.
    const share = firstPassShare(budget, states.length);
    for (const st of states) {
      if (!canContinue()) break;
      await this.pageThrough(st, share, opts, stats, seen, canContinue);
    }
    for (const st of states) {
      if (!canContinue()) break;
      if (!st.done) await this.pageThrough(st, Infinity, opts, stats, seen, canContinue);
    }

    this.logger.log(
      `linkedin: ${stats.requests} requests · ${stats.cards} cards · ${stats.new} new` +
        (stats.blocked ? ' · BLOCKED' : '') +
        (stats.saturated.length ? ` · saturated: ${stats.saturated.join(', ')}` : ''),
    );
    return stats;
  }

  private async pageThrough(
    st: SearchState,
    maxPages: number,
    opts: { now: Date; windowSeconds: number },
    stats: LinkedInStats,
    seen: Set<string>,
    canContinue: () => boolean,
  ): Promise<void> {
    let pages = 0;
    try {
      while (!st.done && pages < maxPages && canContinue()) {
        stats.requests++;
        let html: string;
        try {
          html = await this.http.getText(
            searchUrl(st.search.location, opts.windowSeconds, st.start),
            {
              timeoutMs: 15_000,
              maxAttempts: 2,
              headers: { accept: 'text/html' },
            },
          );
        } catch (err) {
          if (isHostBlockedError(err)) {
            stats.blocked = true;
          } else if (err instanceof HttpError && err.status === 400 && st.start > 0) {
            st.done = true; // LinkedIn answers 400 past the last page
          } else {
            stats.errors++;
            st.done = true;
            this.logger.warn(`linkedin ${st.search.location}: ${(err as Error).message}`);
          }
          return;
        }

        const page = parseLinkedInSearch(html);
        if (page.looksBlocked) {
          stats.blocked = true; // a bot check: stop for today, never try to get around it
          return;
        }
        if (page.cards === 0) {
          st.done = true;
          return;
        }
        pages++;
        st.start += page.cards;
        stats.cards += page.cards;
        for (const job of page.jobs) {
          if (seen.has(job.externalId)) continue;
          seen.add(job.externalId);
          st.buffer.push(job);
        }
        if (st.buffer.length >= FLUSH_EVERY) await this.flush(st, opts.now, stats);
        if (st.start >= MAX_JOBS_PER_SEARCH) {
          st.done = true;
          stats.saturated.push(st.search.location);
        }
      }
    } finally {
      await this.flush(st, opts.now, stats);
    }
  }

  private async flush(st: SearchState, now: Date, stats: LinkedInStats): Promise<void> {
    if (st.buffer.length === 0) return;
    const raws = st.buffer;
    st.buffer = [];
    const batch = prepareBatch(raws, {
      now,
      maxAgeDays: setting(this.config, 'MAX_JOB_AGE_DAYS'),
      targetCountries: setting(this.config, 'TARGET_COUNTRIES'),
      searchCountry: st.search.country,
      isBoard: false,
      blocklist: COMPANY_BLOCKLIST,
    });
    const saved = await this.store.saveBatch(batch, {
      source: JobSource.LINKEDIN,
      discoveredVia: 'linkedin',
      now,
    });
    stats.new += saved.inserted;
  }
}
