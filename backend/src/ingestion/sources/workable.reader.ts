import { Injectable } from '@nestjs/common';
import { HttpClient } from '../../common/http/http-client.js';
import { Ats, JobSource } from '../../generated/prisma/enums.js';
import { compact, joinParts, requestOptions, toDate } from './reader-helpers.js';
import { parseResponse, workableJobsSchema, type WorkableJob } from './schemas.js';
import type { BoardRead, BoardReader, RawJob, ReadOptions } from './source.types.js';

/** 10 jobs a page, so up to 500 jobs. */
const DEFAULT_MAX_PAGES = 50;

/** Empty filters: every job on the board. GET on this endpoint answers 404. */
const SEARCH_ALL = { query: '', location: [], department: [], worktype: [], remote: [] };

// Workable careers API (docs/ARCHITECTURE.md §3.3). Pages hold 10 jobs. A full page carries
// `nextPage`, an opaque cursor (base64 of [publishedMs, id] of its last job); the next page is
// the same POST with `token: nextPage` added to the body. Workable rate-limits hard (a burst of
// probes earned a 429 with Retry-After of about 24 hours), so keep calls few.
@Injectable()
export class WorkableReader implements BoardReader {
  readonly ats = Ats.WORKABLE;

  constructor(private readonly http: HttpClient) {}

  async read(slug: string, opts: ReadOptions = {}): Promise<BoardRead> {
    const maxPages = opts.maxPages ?? DEFAULT_MAX_PAGES;
    const url = `https://apply.workable.com/api/v3/accounts/${encodeURIComponent(slug)}/jobs`;
    const jobs: RawJob[] = [];
    let token: string | undefined;
    let total: number | null | undefined;

    for (let page = 0; page < maxPages; page++) {
      const search = token ? { ...SEARCH_ALL, token } : SEARCH_ALL;
      const body = await this.http.postJson(url, search, requestOptions(opts));
      const data = parseResponse(workableJobsSchema, body, url);
      jobs.push(...data.results.map((job) => toRawJob(slug, job)));
      total = data.total;

      const next = data.nextPage ?? undefined;
      if (!next || next === token || data.results.length === 0) return { jobs, truncated: false };
      token = next;
    }
    // Stopped at maxPages with a nextPage in hand. A full last page always carries nextPage,
    // even when nothing follows, so `total` decides whether jobs were really left.
    return { jobs, truncated: total == null || jobs.length < total };
  }
}

function toRawJob(slug: string, job: WorkableJob): RawJob {
  const listed = job.locations ?? [];
  const places = listed.length > 0 ? listed : [job.location];
  return {
    source: JobSource.WORKABLE,
    externalId: job.shortcode,
    title: job.title,
    locations: compact(places.map((p) => joinParts(p?.city, p?.region, p?.country))),
    countryCodes: compact([job.location?.countryCode, ...listed.map((p) => p.countryCode)]),
    workModeHint: job.workplace ?? (job.remote ? 'remote' : undefined),
    url: `https://apply.workable.com/${encodeURIComponent(slug)}/j/${encodeURIComponent(job.shortcode)}/`,
    postedAt: toDate(job.published),
  };
}
