// URL search params <-> JobFilters + display mode. Invalid values fall back to defaults.
import type { Country, JobFilters, JobSource, View, WorkMode } from "./types";

export type Mode = "jobs" | "companies";
export type FilterableWorkMode = Exclude<WorkMode, "UNKNOWN">;
export type RawSearchParams = Record<string, string | string[] | undefined>;

export const VIEWS: readonly View[] = ["new", "week", "all"];
export const MODES: readonly Mode[] = ["jobs", "companies"];
export const COUNTRIES: readonly Country[] = ["IN", "AE", "US"];
export const WORK_MODES: readonly FilterableWorkMode[] = ["ONSITE", "HYBRID", "REMOTE"];
export const SOURCES: readonly JobSource[] = [
  "LINKEDIN",
  "GREENHOUSE",
  "LEVER",
  "ASHBY",
  "SMARTRECRUITERS",
  "WORKABLE",
];

export const DEFAULT_VIEW: View = "new";
export const DEFAULT_MODE: Mode = "jobs";
export const DEFAULT_PAGE_SIZE = 50;
export const MAX_PAGE_SIZE = 100; // the API rejects more
export const MIN_QUERY_LENGTH = 2;
const MAX_QUERY_LENGTH = 100;

export type PageState = { filters: JobFilters; mode: Mode };

export function parseSearchParams(raw: RawSearchParams): PageState {
  return {
    mode: oneOf(first(raw.mode), MODES) ?? DEFAULT_MODE,
    filters: {
      view: oneOf(first(raw.view), VIEWS) ?? DEFAULT_VIEW,
      country: oneOf(first(raw.country)?.toUpperCase(), COUNTRIES),
      workMode: oneOf(first(raw.workMode)?.toUpperCase(), WORK_MODES),
      source: oneOf(first(raw.source)?.toUpperCase(), SOURCES),
      q: normalizeQuery(first(raw.q)),
      page: positiveInt(first(raw.page)) ?? 1,
      pageSize: pageSize(first(raw.pageSize)),
    },
  };
}

/** Builds the page's query string. Defaults and empty values are left out so links stay short. */
export function toSearchParams(filters: JobFilters, mode: Mode = DEFAULT_MODE): URLSearchParams {
  const params = new URLSearchParams();
  if (filters.view !== DEFAULT_VIEW) params.set("view", filters.view);
  if (filters.country) params.set("country", filters.country);
  if (filters.workMode) params.set("workMode", filters.workMode);
  if (filters.source) params.set("source", filters.source);
  if (filters.q) params.set("q", filters.q);
  if (mode !== DEFAULT_MODE) params.set("mode", mode);
  if (filters.page > 1) params.set("page", String(filters.page));
  if (filters.pageSize !== DEFAULT_PAGE_SIZE) params.set("pageSize", String(filters.pageSize));
  return params;
}

/** Link to the sales page for these filters. */
export function salesPageHref(filters: JobFilters, mode: Mode = DEFAULT_MODE): string {
  const query = toSearchParams(filters, mode).toString();
  return query ? `/?${query}` : "/";
}

/** Trimmed search text, or undefined when it is too short to search. */
export function normalizeQuery(value: string | undefined): string | undefined {
  const trimmed = value?.trim().slice(0, MAX_QUERY_LENGTH);
  return trimmed && trimmed.length >= MIN_QUERY_LENGTH ? trimmed : undefined;
}

/** True when any narrowing filter (country, work mode, source, search) is set. */
export function hasActiveFilters(filters: JobFilters): boolean {
  return Boolean(filters.country || filters.workMode || filters.source || filters.q);
}

/** The same view and page size with every narrowing filter removed. */
export function clearFilters(filters: JobFilters): JobFilters {
  return { view: filters.view, page: 1, pageSize: filters.pageSize };
}

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function oneOf<T extends string>(value: string | undefined, allowed: readonly T[]): T | undefined {
  return allowed.find((item) => item === value);
}

function positiveInt(value: string | undefined): number | undefined {
  if (!value || !/^\d{1,6}$/.test(value)) return undefined;
  const n = Number(value);
  return n >= 1 ? n : undefined;
}

function pageSize(value: string | undefined): number {
  const n = positiveInt(value);
  return n !== undefined && n <= MAX_PAGE_SIZE ? n : DEFAULT_PAGE_SIZE;
}
