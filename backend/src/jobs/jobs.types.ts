// Response shapes. They mirror frontend/lib/types.ts exactly; change both together.
import type { JobSource, RunStatus, WorkMode } from '../generated/prisma/enums.js';

export type JobItem = {
  id: string;
  title: string;
  company: { id: string; name: string };
  location: string | null;
  /** ISO 3166-1 alpha-2 code, or null when unknown. */
  country: string | null;
  workMode: WorkMode;
  url: string;
  source: JobSource;
  postedAt: string;
  firstSeenAt: string;
};

export type Paged<T> = { items: T[]; total: number; page: number; pageSize: number };

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
  lastRun: {
    id: string;
    status: RunStatus;
    startedAt: string;
    finishedAt: string | null;
    newJobs: number;
    newCompanies: number;
  } | null;
  isRunning: boolean;
  today: { newJobs: number; companies: number };
};

/** One country in the sales page's filter: open roles (within the age limit) per country. */
export type CountryCount = { code: string; jobs: number };
