import { JobSource } from '../../generated/prisma/enums.js';
import { cleanCompanyUrl } from './linkedin.parser.js';
import { compact, toDate } from './reader-helpers.js';
import type { ApifyLinkedInJob } from './schemas.js';
import type { RawJob } from './source.types.js';

// Pure helpers for reading LinkedIn through Apify (docs/ARCHITECTURE.md, "As built: LinkedIn
// via Apify"). The service is linkedin-apify.service.ts.

/** Public LinkedIn job search for one place, posted within the window (f_TPR=r{seconds}). */
export function apifySearchUrl(location: string, windowSeconds: number): string {
  const params = new URLSearchParams({ location, f_TPR: `r${windowSeconds}` });
  return `https://www.linkedin.com/jobs/search/?${params.toString()}`;
}

/** Input for curious_coder/linkedin-jobs-scraper: our searches, a per-search limit, no extras. */
export function apifyInput(
  locations: readonly string[],
  maxJobs: number,
  windowSeconds: number,
): Record<string, unknown> {
  return {
    urls: locations.map((location) => apifySearchUrl(location, windowSeconds)),
    // Split the limit evenly; Apify's maxItems still caps the total we pay for.
    limitPerSource: Math.max(1, Math.ceil(maxJobs / Math.max(1, locations.length))),
    // Company pages cost extra requests and we don't store company details.
    scrapeCompany: false,
    splitByLocation: false,
  };
}

/** How many jobs today's limit still allows. */
export function remainingToday(dailyLimit: number, usedToday: number): number {
  return Math.max(0, dailyLimit - usedToday);
}

/** Apify's run states that mean the run has ended. */
export const FINISHED_RUN_STATES: ReadonlySet<string> = new Set([
  'SUCCEEDED',
  'FAILED',
  'TIMED-OUT',
  'ABORTED',
]);

/** One Apify item as a RawJob. Only the fields we store; recruiter details are never kept. */
export function apifyItemToRawJob(item: ApifyLinkedInJob): RawJob {
  return {
    source: JobSource.LINKEDIN,
    externalId: item.id,
    title: item.title,
    companyName: item.companyName ?? undefined,
    companyLinkedinUrl: cleanCompanyUrl(item.companyLinkedinUrl ?? undefined),
    locations: compact([item.location]),
    countryCodes: [],
    // The same clean link our own LinkedIn reader saves, so both providers dedupe together.
    url: `https://www.linkedin.com/jobs/view/${item.id}`,
    postedAt: toDate(item.postedAtTimestamp ?? item.postedAt ?? undefined),
  };
}
