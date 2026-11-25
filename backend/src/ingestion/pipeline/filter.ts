import { daysBefore } from '../../common/time.js';
import type { Country } from '../../generated/prisma/enums.js';
import type { RawJob } from '../sources/source.types.js';
import { resolveCountry } from './country.js';
import { fingerprint, normalizeCompany } from './normalize.js';
import type {
  BatchContext,
  CountryResult,
  DropReason,
  NormalizedJob,
  PreparedBatch,
  SeenJob,
} from './pipeline.types.js';
import { resolveWorkMode } from './work-mode.js';

/** A job with every required field, cleaned, waiting for its country decision. */
type Candidate = {
  job: Omit<NormalizedJob, 'country'>;
  countryResult: CountryResult;
};

type CountryDecision =
  { keep: true; country: Country | null } | { keep: false; reason: DropReason };

/**
 * Steps 1–2 of the job store (docs/ARCHITECTURE.md §3.7): clean, resolve, filter and
 * deduplicate one batch (one board response or one LinkedIn page). Pure: no I/O.
 */
export function prepareBatch(raws: RawJob[], ctx: BatchContext): PreparedBatch {
  const dropped = emptyDropCounts();
  const candidates: Candidate[] = [];
  for (const raw of raws) {
    const candidate = toCandidate(raw, ctx);
    if (candidate) candidates.push(candidate);
    else dropped.missing_fields++;
  }

  const seen: SeenJob[] = candidates.map(({ job }) => ({
    externalId: job.externalId,
    fingerprint: job.fingerprint,
  }));

  // The board rule looks at the whole response, so old jobs still show where a company hires.
  const batchHasTargetJob = candidates.some(({ countryResult }) => isTarget(countryResult));
  const cutoffMs = daysBefore(ctx.now, ctx.maxAgeDays).getTime();
  const kept = new Map<string, NormalizedJob>();

  for (const { job, countryResult } of candidates) {
    if (job.postedAt.getTime() < cutoffMs) {
      dropped.too_old++;
      continue;
    }
    const decision = decideCountry(countryResult, ctx, batchHasTargetJob);
    if (!decision.keep) {
      dropped[decision.reason]++;
      continue;
    }
    if (ctx.blocklist.has(job.normalizedCompany)) {
      dropped.blocklisted++;
      continue;
    }
    if (kept.has(job.fingerprint)) {
      dropped.duplicate_in_batch++;
      continue;
    }
    kept.set(job.fingerprint, { ...job, country: decision.country });
  }

  return { seen, kept: [...kept.values()], dropped };
}

/** Cleans one raw job, or returns null when it lacks an id, title, company or url. */
function toCandidate(raw: RawJob, ctx: BatchContext): Candidate | null {
  const externalId = clean(raw.externalId);
  const title = clean(raw.title);
  const companyName = clean(ctx.companyName ?? raw.companyName);
  const url = clean(raw.url);
  if (!externalId || !title || !companyName || !url) return null;

  const location = clean(raw.locations[0]) || null;
  const companyLinkedinUrl = clean(raw.companyLinkedinUrl) || undefined;

  return {
    job: {
      source: raw.source,
      externalId,
      title,
      companyName,
      normalizedCompany: normalizeCompany(companyName),
      ...(companyLinkedinUrl ? { companyLinkedinUrl } : {}),
      location,
      workMode: resolveWorkMode({
        workModeHint: raw.workModeHint,
        locations: raw.locations,
        title,
      }),
      url,
      postedAt: isValidDate(raw.postedAt) ? raw.postedAt : ctx.now,
      fingerprint: fingerprint(companyName, title, location),
    },
    countryResult: resolveCountry(
      { locations: raw.locations, countryCodes: raw.countryCodes },
      { targetCountries: ctx.targetCountries },
    ),
  };
}

function decideCountry(
  result: CountryResult,
  ctx: BatchContext,
  batchHasTargetJob: boolean,
): CountryDecision {
  if (isTarget(result)) return { keep: true, country: result };
  // LinkedIn: the search was for one country, so anything unclear belongs to it.
  if (ctx.searchCountry) return { keep: true, country: ctx.searchCountry };
  if (result === 'OUT') return { keep: false, reason: 'outside_markets' };
  // Plain remote on a board that also hires in one of our countries.
  if (ctx.isBoard && batchHasTargetJob) return { keep: true, country: null };
  return { keep: false, reason: 'remote_without_market' };
}

/** resolveCountry already turns non-target countries into 'OUT'. */
function isTarget(result: CountryResult): result is Country {
  return result !== null && result !== 'OUT';
}

function clean(value: string | undefined): string {
  return (value ?? '').trim();
}

function isValidDate(value: Date | undefined): value is Date {
  return value instanceof Date && !Number.isNaN(value.getTime());
}

function emptyDropCounts(): Record<DropReason, number> {
  return {
    missing_fields: 0,
    too_old: 0,
    outside_markets: 0,
    remote_without_market: 0,
    blocklisted: 0,
    duplicate_in_batch: 0,
  };
}
