// Per-host politeness rules (docs/ARCHITECTURE.md §3.4).

export type HostPolicy = {
  /** Most requests in flight at once. */
  concurrency: number;
  /** Minimum time between two request starts. */
  minGapMs: number;
  /** Extra random wait (0..jitterMs) added to the gap. */
  jitterMs?: number;
  /** Open the circuit after 3 calls in a row end in 429, and stop calling the host. */
  breaker?: boolean;
  userAgent: string;
  /** Full-jitter backoff base and cap. Default 1 s and 30 s. */
  retryBaseMs?: number;
  retryCapMs?: number;
};

export const OPENROLES_USER_AGENT = 'OpenRoles/1.0';

/** A normal desktop browser, for LinkedIn's logged-out guest pages only. */
export const BROWSER_USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36';

export const DEFAULT_RETRY_BASE_MS = 1_000;
export const DEFAULT_RETRY_CAP_MS = 30_000;

const ATS_API: HostPolicy = {
  concurrency: 4,
  minGapMs: 100,
  breaker: true,
  userAgent: OPENROLES_USER_AGENT,
};

/** Workable blocks bursts for about a day (Retry-After: 86081 seen), so it gets one slow lane. */
const WORKABLE: HostPolicy = {
  concurrency: 1,
  minGapMs: 1_500,
  jitterMs: 1_000,
  breaker: true,
  userAgent: OPENROLES_USER_AGENT,
};

const HOST_POLICIES: Record<string, HostPolicy> = {
  'www.linkedin.com': {
    concurrency: 1,
    minGapMs: 2_000,
    jitterMs: 3_000,
    breaker: true,
    userAgent: BROWSER_USER_AGENT,
    retryBaseMs: 30_000,
    retryCapMs: 120_000,
  },
  'boards-api.greenhouse.io': ATS_API,
  'api.lever.co': ATS_API,
  'api.eu.lever.co': ATS_API,
  'api.ashbyhq.com': ATS_API,
  'api.smartrecruiters.com': ATS_API,
  'apply.workable.com': WORKABLE,
  'yc-oss.github.io': { concurrency: 1, minGapMs: 0, userAgent: OPENROLES_USER_AGENT },
  /** Common Crawl's index is a shared free service: one request at a time, slow retries. */
  'index.commoncrawl.org': {
    concurrency: 1,
    minGapMs: 1_000,
    jitterMs: 1_000,
    breaker: true,
    userAgent: OPENROLES_USER_AGENT,
    retryBaseMs: 5_000,
    retryCapMs: 60_000,
  },
};

export const DEFAULT_POLICY: HostPolicy = {
  concurrency: 2,
  minGapMs: 200,
  userAgent: OPENROLES_USER_AGENT,
};

export function policyFor(hostname: string): HostPolicy {
  return HOST_POLICIES[hostname.toLowerCase()] ?? DEFAULT_POLICY;
}
