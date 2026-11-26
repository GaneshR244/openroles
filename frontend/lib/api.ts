import "server-only";

import { requestNow } from "./now";
import type {
  CompanyItem,
  CountryCount,
  JobFilters,
  JobItem,
  JobSummary,
  Paged,
  RunSummary,
} from "./types";

/** A failed call to the OpenRoles API. `status` is the HTTP status, or 0 when no response arrived. */
export class ApiError extends Error {
  readonly status: number;

  constructor(status: number, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "ApiError";
    this.status = status;
  }
}

const REVALIDATE_SECONDS = 300;

export async function getJobs(filters: JobFilters): Promise<Paged<JobItem>> {
  if (sampleDataEnabled()) {
    const sample = await import("./sample-data");
    return sample.sampleJobs(filters, await requestNow());
  }
  return apiGet(`/api/jobs?${filterQuery(filters)}`);
}

export async function getCompanies(filters: JobFilters): Promise<Paged<CompanyItem>> {
  if (sampleDataEnabled()) {
    const sample = await import("./sample-data");
    return sample.sampleCompanies(filters, await requestNow());
  }
  return apiGet(`/api/companies?${filterQuery(filters)}`);
}

export async function getCompanyJobs(
  id: string,
): Promise<{ company: CompanyItem; jobs: JobItem[] }> {
  if (sampleDataEnabled()) {
    const sample = await import("./sample-data");
    const result = sample.sampleCompanyJobs(id, await requestNow());
    if (!result) throw new ApiError(404, `Company ${id} not found (sample data)`);
    return result;
  }
  return apiGet(`/api/companies/${encodeURIComponent(id)}/jobs`);
}

/** Roles, companies and countries for the current view and filters. */
export async function getSummary(filters: JobFilters): Promise<JobSummary> {
  if (sampleDataEnabled()) {
    const sample = await import("./sample-data");
    return sample.sampleSummary(filters, await requestNow());
  }
  return apiGet(`/api/summary?${filterQuery(filters)}`);
}

/** Countries with open roles, most first, for the country filter. */
export async function getCountries(): Promise<CountryCount[]> {
  if (sampleDataEnabled()) {
    const sample = await import("./sample-data");
    return sample.sampleCountries(await requestNow());
  }
  return apiGet("/api/countries");
}

export async function getRunSummary(): Promise<RunSummary> {
  if (sampleDataEnabled()) {
    const sample = await import("./sample-data");
    return sample.sampleRunSummary(await requestNow());
  }
  return apiGet("/api/runs/latest");
}

/** Dev-only switch (see .env.example). Production builds never serve sample data. */
function sampleDataEnabled(): boolean {
  return process.env.NODE_ENV !== "production" && process.env.OPENROLES_SAMPLE_DATA === "1";
}

function filterQuery(filters: JobFilters): string {
  const params = new URLSearchParams({
    view: filters.view,
    page: String(filters.page),
    pageSize: String(filters.pageSize),
  });
  if (filters.country) params.set("country", filters.country);
  if (filters.source) params.set("source", filters.source);
  if (filters.q) params.set("q", filters.q);
  return params.toString();
}

async function apiGet<T>(path: string): Promise<T> {
  const baseUrl = process.env.API_URL?.replace(/\/+$/, "");
  const apiKey = process.env.API_KEY;
  if (!baseUrl || !apiKey) {
    throw new ApiError(500, "API_URL and API_KEY must be set (see frontend/.env.example)");
  }

  let res: Response;
  try {
    res = await fetch(`${baseUrl}${path}`, {
      headers: { "x-api-key": apiKey },
      next: { revalidate: REVALIDATE_SECONDS },
    });
  } catch (error) {
    // Network failures surface as TypeError ("fetch failed"). Anything else is rethrown as is.
    if (error instanceof TypeError) {
      throw new ApiError(0, `Could not reach the OpenRoles API (${path})`, { cause: error });
    }
    throw error;
  }

  if (!res.ok) {
    throw new ApiError(res.status, `OpenRoles API returned ${res.status} for ${path}`);
  }
  try {
    return (await res.json()) as T;
  } catch (error) {
    throw new ApiError(502, `OpenRoles API sent invalid JSON for ${path}`, { cause: error });
  }
}
