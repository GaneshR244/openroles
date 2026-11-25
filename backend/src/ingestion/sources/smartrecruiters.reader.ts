import { Injectable } from '@nestjs/common';
import { HttpClient } from '../../common/http/http-client.js';
import { Ats, JobSource } from '../../generated/prisma/enums.js';
import { compact, joinParts, requestOptions, toDate } from './reader-helpers.js';
import {
  parseResponse,
  smartRecruitersPageSchema,
  type SmartRecruitersPosting,
} from './schemas.js';
import type { BoardRead, BoardReader, RawJob, ReadOptions } from './source.types.js';

const PAGE_SIZE = 100;
const DEFAULT_MAX_PAGES = 20;

// SmartRecruiters postings API (docs/ARCHITECTURE.md §3.3). Paged by offset until totalFound.
// Company identifiers are case-sensitive. An unknown company answers 200 with totalFound 0,
// never 404, so it reads as an empty board.
@Injectable()
export class SmartRecruitersReader implements BoardReader {
  readonly ats = Ats.SMARTRECRUITERS;

  constructor(private readonly http: HttpClient) {}

  async read(slug: string, opts: ReadOptions = {}): Promise<BoardRead> {
    const maxPages = opts.maxPages ?? DEFAULT_MAX_PAGES;
    const base = `https://api.smartrecruiters.com/v1/companies/${encodeURIComponent(slug)}/postings`;
    const jobs: RawJob[] = [];
    let offset = 0;

    for (let page = 0; page < maxPages; page++) {
      const url = `${base}?limit=${PAGE_SIZE}&offset=${offset}`;
      const body = await this.http.getJson(url, requestOptions(opts));
      const data = parseResponse(smartRecruitersPageSchema, body, url);
      jobs.push(...data.content.map((posting) => toRawJob(slug, posting)));
      offset += data.content.length;
      if (offset >= data.totalFound) return { jobs, truncated: false };
      // An empty page before totalFound means the list was cut short: never treat it as complete.
      if (data.content.length === 0) return { jobs, truncated: true };
    }
    // Stopped at maxPages with postings still left.
    return { jobs, truncated: true };
  }
}

function toRawJob(slug: string, posting: SmartRecruitersPosting): RawJob {
  const location = posting.location;
  return {
    source: JobSource.SMARTRECRUITERS,
    externalId: posting.id,
    title: posting.name,
    companyName: posting.company?.name ?? undefined,
    locations: compact([location?.fullLocation || joinParts(location?.city, location?.country)]),
    countryCodes: compact([location?.country]),
    workModeHint: workMode(location?.remote, location?.hybrid),
    url: `https://jobs.smartrecruiters.com/${encodeURIComponent(slug)}/${encodeURIComponent(posting.id)}`,
    postedAt: toDate(posting.releasedDate),
  };
}

function workMode(remote?: boolean | null, hybrid?: boolean | null): string | undefined {
  if (remote) return 'remote';
  if (hybrid) return 'hybrid';
  if (remote === false) return 'onsite';
  return undefined;
}
