import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Ats } from '../generated/prisma/enums.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { type AppConfig, setting } from '../config/app-config.js';
import { HttpError, NotFoundError, isHostBlockedError } from '../common/http/errors.js';
import { runPool } from '../common/pool.js';
import { daysBefore } from '../common/time.js';
import { BoardReaders } from './sources/board-readers.js';
import type { RawJob } from './sources/source.types.js';
import { normalizeCompany } from './pipeline/normalize.js';
import { resolveCountries } from './pipeline/country.js';

// Finds public ATS boards for companies we already know (docs/ARCHITECTURE.md §3.9).

const COMPANY_WORKERS = 4;
const RECHECK_AFTER_DAYS = 30;
const PROBE = { timeoutMs: 3000, maxAttempts: 1, maxPages: 1 } as const;
// Workable is not probed: it rate-limits bursts for about 24 hours, so guessing slugs there
// would block our daily reads. Workable boards can still be added by hand or found from links.
const PROBE_ATS: readonly Ats[] = [Ats.GREENHOUSE, Ats.LEVER, Ats.ASHBY, Ats.SMARTRECRUITERS];

export type FinderStats = {
  probedCompanies: number;
  boardsFound: number;
  probeErrors: number;
  stoppedByDeadline: boolean;
};

type Candidate = { id: string; name: string; normalizedName: string; website: string | null };

function titleCaseJoined(normalized: string): string {
  return normalized
    .split(' ')
    .filter(Boolean)
    .map((w) => w[0]!.toUpperCase() + w.slice(1))
    .join('');
}

/** Hosts that belong to the job-board systems themselves, not to the hiring company. */
const ATS_HOSTS = [
  'greenhouse.io',
  'lever.co',
  'ashbyhq.com',
  'smartrecruiters.com',
  'workable.com',
];
/** Two-part public suffixes we see in practice ("acme.co.in" → "acme"). */
const SECOND_LEVEL = new Set(['co', 'com', 'net', 'org', 'ac', 'gov']);

/** The company's own name in a host: "careers.getweave.com" → "getweave", "acme.co.in" → "acme". */
export function domainLabel(hostOrUrl: string | null | undefined): string | null {
  if (!hostOrUrl) return null;
  try {
    const host = new URL(hostOrUrl.includes('://') ? hostOrUrl : `https://${hostOrUrl}`).hostname
      .toLowerCase()
      .replace(/^www\./, '');
    const parts = host.split('.').filter(Boolean);
    if (parts.length < 2) return null;
    const twoPartSuffix = parts.length >= 3 && SECOND_LEVEL.has(parts[parts.length - 2]!);
    const label = parts[parts.length - (twoPartSuffix ? 3 : 2)];
    return label && /^[a-z0-9-]+$/.test(label) ? label : null;
  } catch {
    return null;
  }
}

function websiteLabel(website: string | null): string | null {
  return domainLabel(website);
}

function isAtsHost(url: string): boolean {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return ATS_HOSTS.some((h) => host === h || host.endsWith(`.${h}`));
  } catch {
    return true; // unparseable: no evidence either way
  }
}

/**
 * Same-name companies are the main risk of slug guessing. When a board's jobs link to the
 * company's own careers site, that domain must match the website we know.
 */
export function domainConflicts(jobs: readonly RawJob[], website: string | null): boolean {
  const ours = websiteLabel(website);
  if (!ours) return false;
  return jobs.some((j) => !isAtsHost(j.url) && domainLabel(j.url) !== ours);
}

const ATS_PREFERENCE: readonly Ats[] = [Ats.ASHBY, Ats.GREENHOUSE, Ats.LEVER, Ats.SMARTRECRUITERS];

/**
 * A company almost never uses two job-board systems at once, so several verified hits usually
 * mean a same-name company. Keep one: the board named like the company's website first, then
 * the more common system.
 */
export function pickBoard(
  hits: readonly { ats: Ats; slug: string }[],
  website: string | null,
): { ats: Ats; slug: string } | null {
  if (hits.length === 0) return null;
  const label = websiteLabel(website);
  const byWebsite = label ? hits.find((h) => h.slug.toLowerCase() === label) : undefined;
  if (byWebsite) return byWebsite;
  return [...hits].sort(
    (a, b) => ATS_PREFERENCE.indexOf(a.ats) - ATS_PREFERENCE.indexOf(b.ats),
  )[0]!;
}

/**
 * Board-name guesses for a company, at most 4. "Acme Payments" → acmepayments, acme-payments,
 * plus the website label. SmartRecruiters IDs are case-sensitive, so it also gets "AcmePayments".
 */
export function slugCandidates(
  company: Pick<Candidate, 'normalizedName' | 'website'>,
  ats: Ats,
): string[] {
  const n = company.normalizedName;
  const guesses = [n.replace(/ /g, ''), n.replace(/ /g, '-'), websiteLabel(company.website)];
  if (ats === Ats.SMARTRECRUITERS) guesses.splice(1, 0, titleCaseJoined(n));
  const unique = [...new Set(guesses.filter((g): g is string => !!g && g.length >= 2))];
  return unique.slice(0, 4);
}

/**
 * A probe hit counts only if the board has jobs, the name matches (the API's company name,
 * or the slug equals our cleaned name exactly), its job links don't point to another
 * company's website, and (when TARGET_COUNTRIES is set) at least one job is in those countries.
 */
export function verifyHit(
  jobs: readonly RawJob[],
  company: Pick<Candidate, 'normalizedName'> & { website?: string | null },
  slug: string,
  targetCountries: readonly string[],
): boolean {
  if (jobs.length === 0) return false;
  if (domainConflicts(jobs, company.website ?? null)) return false;
  const apiName = jobs.find((j) => j.companyName)?.companyName;
  const nameMatches = apiName ? normalizeCompany(apiName) === company.normalizedName : false;
  const slugMatches =
    slug.toLowerCase().replace(/-/g, '') === company.normalizedName.replace(/ /g, '');
  if (!nameMatches && !slugMatches) return false;
  if (targetCountries.length === 0) return true;
  const targets = new Set(targetCountries);
  return jobs.some((j) =>
    resolveCountries({ locations: j.locations, countryCodes: j.countryCodes }).countries.some(
      (c) => targets.has(c),
    ),
  );
}

@Injectable()
export class BoardFinderService {
  private readonly logger = new Logger(BoardFinderService.name);
  private readonly config: AppConfig;

  constructor(
    private readonly prisma: PrismaService,
    private readonly readers: BoardReaders,
    config: ConfigService,
  ) {
    this.config = config as unknown as AppConfig;
  }

  async run(opts: { now: Date; deadline: Date; limit?: number }): Promise<FinderStats> {
    const stats: FinderStats = {
      probedCompanies: 0,
      boardsFound: 0,
      probeErrors: 0,
      stoppedByDeadline: false,
    };
    const companies = await this.candidates(
      opts.now,
      opts.limit ?? setting(this.config, 'MAX_COMPANY_PROBES'),
    );
    const targetCountries = setting(this.config, 'TARGET_COUNTRIES');

    const pastDeadline = () => {
      const stop = Date.now() >= opts.deadline.getTime();
      if (stop) stats.stoppedByDeadline = true;
      return stop;
    };
    await runPool(
      companies,
      COMPANY_WORKERS,
      async (company) => {
        const found = await this.probeCompany(company, targetCountries, stats);
        const board = pickBoard(found, company.website);
        if (board) {
          const created = await this.prisma.board.createMany({
            data: [
              { ats: board.ats, slug: board.slug, companyId: company.id, nextFetchAt: opts.now },
            ],
            skipDuplicates: true,
          });
          stats.boardsFound += created.count;
        }
        await this.prisma.company.update({
          where: { id: company.id },
          data: { boardsCheckedAt: opts.now },
        });
        stats.probedCompanies++;
      },
      pastDeadline,
      (company, err) => {
        stats.probeErrors++;
        this.logger.error(`board finder ${company.name}: ${(err as Error)?.message ?? err}`);
      },
    );

    this.logger.log(
      `board finder: ${stats.probedCompanies} companies checked · ${stats.boardsFound} new boards`,
    );
    return stats;
  }

  /** Companies never checked, or with no board and last checked over 30 days ago. LinkedIn finds first. */
  private async candidates(now: Date, limit: number): Promise<Candidate[]> {
    const where = {
      OR: [
        { boardsCheckedAt: null },
        { boards: { none: {} }, boardsCheckedAt: { lt: daysBefore(now, RECHECK_AFTER_DAYS) } },
      ],
    };
    const select = { id: true, name: true, normalizedName: true, website: true } as const;
    const linkedin = await this.prisma.company.findMany({
      where: { ...where, discoveredVia: 'linkedin' },
      orderBy: { createdAt: 'desc' },
      take: limit,
      select,
    });
    if (linkedin.length >= limit) return linkedin;
    const others = await this.prisma.company.findMany({
      where: { ...where, discoveredVia: { not: 'linkedin' } },
      orderBy: { createdAt: 'desc' },
      take: limit - linkedin.length,
      select,
    });
    return [...linkedin, ...others];
  }

  /** Tries each ATS in parallel; within one ATS, guesses run in order until one verifies. */
  private async probeCompany(
    company: Candidate,
    targetCountries: readonly string[],
    stats: FinderStats,
  ): Promise<{ ats: Ats; slug: string }[]> {
    const results = await Promise.all(
      PROBE_ATS.map(async (ats) => {
        for (const slug of slugCandidates(company, ats)) {
          try {
            const { jobs } = await this.readers.get(ats).read(slug, PROBE);
            if (verifyHit(jobs, company, slug, targetCountries)) return { ats, slug };
          } catch (err) {
            // The host refused us (rate limit): stop guessing on this system for now.
            if (isHostBlockedError(err)) {
              stats.probeErrors++;
              break;
            }
            if (!(err instanceof NotFoundError)) {
              stats.probeErrors++;
              if (!(err instanceof HttpError))
                this.logger.debug(`probe ${ats}/${slug}: ${(err as Error)?.message}`);
            }
          }
        }
        return null;
      }),
    );
    return results.filter((r): r is { ats: Ats; slug: string } => r !== null);
  }
}
