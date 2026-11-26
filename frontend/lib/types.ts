// API contract between the NestJS backend and this app (docs/ARCHITECTURE.md §3.13).
// The backend's responses must match these shapes exactly.

/** ISO 3166-1 alpha-2 country code ("IN", "DE"). */
export type Country = string;
export type WorkMode = "ONSITE" | "HYBRID" | "REMOTE" | "UNKNOWN";
export type JobSource =
  | "LINKEDIN"
  | "GREENHOUSE"
  | "LEVER"
  | "ASHBY"
  | "SMARTRECRUITERS"
  | "WORKABLE";
export type View = "new" | "week" | "all";
export type RunStatus = "RUNNING" | "SUCCESS" | "PARTIAL" | "FAILED";

export type JobFilters = {
  view: View;
  country?: Country;
  source?: JobSource;
  /** At least 2 characters; matches job title or company name. */
  q?: string;
  page: number;
  pageSize: number;
};

export type JobItem = {
  id: string;
  title: string;
  company: { id: string; name: string };
  location: string | null;
  country: Country | null;
  workMode: WorkMode;
  url: string;
  source: JobSource;
  /** ISO date-time strings (UTC). */
  postedAt: string;
  firstSeenAt: string;
};

/** One country in the filter: open roles there (the "All open" view). */
export type CountryCount = { code: Country; jobs: number };

/** Totals for the current view and filters (the line above the results). */
export type JobSummary = { roles: number; companies: number; countries: number };

export type Paged<T> = {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
};

export type CompanyItem = {
  id: string;
  name: string;
  linkedinUrl: string | null;
  openRoles: number;
  newToday: number;
  latestPostedAt: string | null;
  sources: JobSource[];
};

export type RunSummary = {
  /** Last finished run, or null if none has finished yet. */
  lastRun: {
    id: string;
    status: RunStatus;
    startedAt: string;
    finishedAt: string | null;
    newJobs: number;
    newCompanies: number;
  } | null;
  isRunning: boolean;
  /** Live counts for today (IST): roles first seen today and the companies they belong to. */
  today: { newJobs: number; companies: number };
};
