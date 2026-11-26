import type { JobSource, WorkMode } from '../../generated/prisma/enums.js';

/** Where a job points (see country.ts). Codes are ISO 3166-1 alpha-2, best first. */
export type CountryMatch = {
  countries: string[];
  /** Nothing to go on but "remote", or no location at all. */
  plainRemote: boolean;
};

/** A cleaned job, ready for the job store (docs/ARCHITECTURE.md §3.5–3.7). */
export type NormalizedJob = {
  source: JobSource;
  externalId: string;
  title: string;
  /** Display name, as first seen. */
  companyName: string;
  /** Dedupe key for the Company table. */
  normalizedCompany: string;
  companyLinkedinUrl?: string;
  /** Primary location text, trimmed. */
  location: string | null;
  /** ISO 3166-1 alpha-2 code; null when the location names no country we can tell. */
  country: string | null;
  workMode: WorkMode;
  url: string;
  /** Source date, or `now` when the source has none. */
  postedAt: Date;
  /** sha1(normalizeCompany | normalizeTitle | normalizeLocation), 40 hex characters. */
  fingerprint: string;
};

/** Identity of every job a fetch returned, used to refresh "last seen" before filtering. */
export type SeenJob = { externalId: string; fingerprint: string };

export type DropReason =
  | 'missing_fields'
  | 'too_old'
  | 'outside_markets'
  | 'remote_without_market'
  | 'blocklisted'
  | 'duplicate_in_batch';

export type BatchContext = {
  now: Date;
  maxAgeDays: number;
  /** ISO codes to keep. Empty means every country. */
  targetCountries: readonly string[];
  /** Board jobs: the Board's company name, which wins over the source's own name. */
  companyName?: string;
  /** LinkedIn jobs: the country of the search that found them. */
  searchCountry?: string;
  /** true for a company board (the plain-remote board rule applies). */
  isBoard: boolean;
  /** Normalized company names to drop. Never contains recruitment agencies. */
  blocklist: ReadonlySet<string>;
};

export type PreparedBatch = {
  /** Every parseable job (has id, title, company, url), even ones filtered out later. */
  seen: SeenJob[];
  /** Jobs that passed every check, deduplicated by fingerprint (first one wins). */
  kept: NormalizedJob[];
  dropped: Record<DropReason, number>;
};
