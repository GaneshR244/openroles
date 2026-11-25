import type { Ats, JobSource } from '../../generated/prisma/enums.js';

/**
 * One job exactly as a source gives it, before any cleaning (docs/ARCHITECTURE.md §3.3).
 * Readers fill in what the source has and leave the rest undefined. They never guess.
 */
export type RawJob = {
  source: JobSource;
  externalId: string;
  title: string;
  /** Company name as the source writes it, when the source includes one. */
  companyName?: string;
  companyLinkedinUrl?: string;
  /** Every location the source lists, as text. The first one is the primary location. */
  locations: string[];
  /** Structured country codes exactly as given ("IN", "in", "USA", "FR"). Empty when none. */
  countryCodes: string[];
  /** Structured work type exactly as given ("onsite", "OnSite", "on_site", "hybrid", "remote"). */
  workModeHint?: string;
  url: string;
  postedAt?: Date;
};

/** Per-read limits. The board finder uses short timeouts, one attempt and one page for probes. */
export type ReadOptions = {
  /** Per-request timeout, passed to HttpClient (default 10 s). */
  timeoutMs?: number;
  /** Attempts per request, passed to HttpClient (default 3). */
  maxAttempts?: number;
  /** Most pages to read on paged sources. Default 20 for SmartRecruiters, 50 for Workable. */
  maxPages?: number;
};

/** What one board read returned. */
export type BoardRead = {
  jobs: RawJob[];
  /**
   * true only when a paged reader stopped at maxPages while more pages remained. A truncated
   * read is not the whole board, so it must never be used to close jobs.
   */
  truncated: boolean;
};

/**
 * Reads every open job on one company board. Throws a typed HttpError on failure;
 * an unknown slug is a NotFoundError where the API answers 404.
 */
export interface BoardReader {
  readonly ats: Ats;
  read(slug: string, opts?: ReadOptions): Promise<BoardRead>;
}
