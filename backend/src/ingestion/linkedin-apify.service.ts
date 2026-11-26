import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JobSource } from '../generated/prisma/enums.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { type AppConfig, setting } from '../config/app-config.js';
import { HttpClient, type RequestOptions } from '../common/http/http-client.js';
import { startOfIstDay } from '../common/time.js';
import { JobStoreService } from './job-store.service.js';
import { disabledLinkedInStats, type LinkedInStats } from './linkedin-lane.service.js';
import { prepareBatch } from './pipeline/filter.js';
import {
  FINISHED_RUN_STATES,
  apifyInput,
  apifyItemToRawJob,
  remainingToday,
} from './sources/apify-linkedin.js';
import { apifyLinkedInJobSchema, apifyRunSchema, parseResponse } from './sources/schemas.js';
import type { RawJob } from './sources/source.types.js';
import {
  APIFY_LINKEDIN_ACTOR,
  APIFY_LINKEDIN_SEARCHES,
  COMPANY_BLOCKLIST,
} from './sources.config.js';

// LinkedIn through Apify (docs/ARCHITECTURE.md, "As built: LinkedIn via Apify"). Apify runs
// curious_coder/linkedin-jobs-scraper on its own servers; we start one run, wait for it, and
// read its results. Every job costs money, so each run is capped twice: the jobs left in today's
// limit (maxItems) and a dollar cap (maxTotalChargeUsd).

const API = 'https://api.apify.com/v2';
/** Longest we wait for one run before stopping it (we still keep what it found). */
const MAX_WAIT_MS = 20 * 60_000;
/** Apify holds each status request open for up to this long while the run works. */
const POLL_SECONDS = 60;
type Run = { id: string; status: string; datasetId: string; usageUsd?: number };

@Injectable()
export class LinkedInApifyLaneService {
  private readonly logger = new Logger(LinkedInApifyLaneService.name);
  private readonly config: AppConfig;

  constructor(
    private readonly http: HttpClient,
    private readonly store: JobStoreService,
    private readonly prisma: PrismaService,
    config: ConfigService,
  ) {
    this.config = config as unknown as AppConfig;
  }

  async run(opts: { now: Date; deadline: Date; windowSeconds: number }): Promise<LinkedInStats> {
    const stats: LinkedInStats = { ...disabledLinkedInStats(), enabled: true, provider: 'apify' };
    const token = setting(this.config, 'APIFY_TOKEN');
    if (!token) {
      stats.errors++;
      this.logger.error('linkedin (apify): APIFY_TOKEN is not set; skipped');
      return stats;
    }

    const maxJobs = remainingToday(
      setting(this.config, 'APIFY_LINKEDIN_DAILY_LIMIT'),
      await this.usedToday(opts.now),
    );
    if (maxJobs === 0) {
      stats.dailyLimitReached = true;
      this.logger.log('linkedin (apify): daily limit already used; no run started');
      return stats;
    }

    const auth = { headers: { authorization: `Bearer ${token}` } };
    try {
      let run = await this.startRun(maxJobs, opts.windowSeconds, auth);
      stats.requests = 1;
      run = await this.waitForRun(run, opts.deadline, auth);
      const raws = await this.readItems(run.datasetId, maxJobs, auth, stats);
      if (run.usageUsd !== undefined) stats.costUsd = run.usageUsd;
      await this.save(raws, opts.now, stats);
      if (run.status !== 'SUCCEEDED') {
        stats.errors++;
        this.logger.warn(`linkedin (apify): run ${run.id} ended ${run.status}; kept what it found`);
      }
    } catch (err) {
      stats.errors++;
      this.logger.error(`linkedin (apify) failed: ${(err as Error)?.message ?? err}`);
    }

    this.logger.log(
      `linkedin (apify): ${stats.cards} jobs · ${stats.new} new` +
        (stats.costUsd !== undefined ? ` · $${stats.costUsd.toFixed(3)}` : ''),
    );
    return stats;
  }

  /** Jobs already taken from Apify today (IST), from the stats of earlier runs. */
  private async usedToday(now: Date): Promise<number> {
    const runs = await this.prisma.fetchRun.findMany({
      where: {
        startedAt: { gte: startOfIstDay(now) },
        stats: { path: ['linkedin', 'provider'], equals: 'apify' },
      },
      select: { stats: true },
    });
    return runs.reduce((sum, r) => {
      const cards = (r.stats as { linkedin?: { cards?: unknown } } | null)?.linkedin?.cards;
      return sum + (typeof cards === 'number' ? cards : 0);
    }, 0);
  }

  /** Starts one run. Never retried: a retry could start a second, paid run. */
  private async startRun(maxJobs: number, windowSeconds: number, auth: RequestOptions) {
    const query = new URLSearchParams({
      maxItems: String(maxJobs),
      maxTotalChargeUsd: String(setting(this.config, 'APIFY_MAX_COST_USD')),
    });
    const url = `${API}/acts/${APIFY_LINKEDIN_ACTOR}/runs?${query.toString()}`;
    const input = apifyInput(
      APIFY_LINKEDIN_SEARCHES.map((s) => s.location),
      maxJobs,
      windowSeconds,
    );
    const body = await this.http.postJson(url, input, {
      ...auth,
      maxAttempts: 1,
      timeoutMs: 30_000,
    });
    return toRun(parseResponse(apifyRunSchema, body, url));
  }

  /** Waits for the run to end; past our time limit it is stopped (results so far are kept). */
  private async waitForRun(run: Run, deadline: Date, auth: RequestOptions): Promise<Run> {
    const stopAt = Math.min(deadline.getTime(), Date.now() + MAX_WAIT_MS);
    let current = run;
    while (!FINISHED_RUN_STATES.has(current.status) && Date.now() < stopAt) {
      const url = `${API}/actor-runs/${current.id}?waitForFinish=${POLL_SECONDS}`;
      const body = await this.http.getJson(url, { ...auth, timeoutMs: (POLL_SECONDS + 15) * 1000 });
      current = toRun(parseResponse(apifyRunSchema, body, url));
    }
    if (!FINISHED_RUN_STATES.has(current.status)) {
      const url = `${API}/actor-runs/${current.id}/abort`;
      const body = await this.http.postJson(url, {}, { ...auth, maxAttempts: 1 });
      current = toRun(parseResponse(apifyRunSchema, body, url));
    }
    return current;
  }

  /** The run's jobs. Each item is checked on its own; a bad item is skipped and counted. */
  private async readItems(
    datasetId: string,
    maxJobs: number,
    auth: RequestOptions,
    stats: LinkedInStats,
  ): Promise<RawJob[]> {
    const url = `${API}/datasets/${datasetId}/items?clean=true&format=json&limit=${maxJobs}`;
    const items = await this.http.getJson<unknown>(url, { ...auth, timeoutMs: 30_000 });
    if (!Array.isArray(items)) throw new Error(`Apify dataset ${datasetId} is not a list`);
    stats.cards = items.length;
    const raws: RawJob[] = [];
    for (const item of items) {
      const parsed = apifyLinkedInJobSchema.safeParse(item);
      if (parsed.success) raws.push(apifyItemToRawJob(parsed.data));
      else stats.errors++;
    }
    return raws;
  }

  private async save(raws: RawJob[], now: Date, stats: LinkedInStats): Promise<void> {
    if (raws.length === 0) return;
    const batch = prepareBatch(raws, {
      now,
      maxAgeDays: setting(this.config, 'MAX_JOB_AGE_DAYS'),
      targetCountries: setting(this.config, 'TARGET_COUNTRIES'),
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

function toRun(response: {
  data: { id: string; status: string; defaultDatasetId: string; usageTotalUsd?: number | null };
}): Run {
  const { id, status, defaultDatasetId, usageTotalUsd } = response.data;
  return { id, status, datasetId: defaultDatasetId, usageUsd: usageTotalUsd ?? undefined };
}
