import { Injectable } from '@nestjs/common';
import { NotFoundError } from '../../common/http/errors.js';
import { HttpClient } from '../../common/http/http-client.js';
import { Ats, JobSource } from '../../generated/prisma/enums.js';
import { compact, requestOptions, toDate } from './reader-helpers.js';
import { leverPostingsSchema, parseResponse, type LeverPosting } from './schemas.js';
import type { BoardRead, BoardReader, RawJob, ReadOptions } from './source.types.js';

// Lever postings API (docs/ARCHITECTURE.md §3.3). EU accounts live on a separate host, so a
// 404 on the global host is retried once on the EU host. Lever gives no company name.
@Injectable()
export class LeverReader implements BoardReader {
  readonly ats = Ats.LEVER;

  constructor(private readonly http: HttpClient) {}

  async read(slug: string, opts: ReadOptions = {}): Promise<BoardRead> {
    const path = `/v0/postings/${encodeURIComponent(slug)}?mode=json`;
    let url = `https://api.lever.co${path}`;
    let body: unknown;
    try {
      body = await this.http.getJson(url, requestOptions(opts));
    } catch (error) {
      if (!(error instanceof NotFoundError)) throw error;
      url = `https://api.eu.lever.co${path}`;
      body = await this.http.getJson(url, requestOptions(opts));
    }

    const jobs = parseResponse(leverPostingsSchema, body, url).map((p) => toRawJob(p));
    return { jobs, truncated: false };
  }
}

function toRawJob(posting: LeverPosting): RawJob {
  const allLocations = posting.categories?.allLocations ?? [];
  return {
    source: JobSource.LEVER,
    externalId: posting.id,
    title: posting.text,
    locations: compact(allLocations.length > 0 ? allLocations : [posting.categories?.location]),
    countryCodes: compact([posting.country]),
    workModeHint: posting.workplaceType ?? undefined,
    url: posting.hostedUrl,
    postedAt: toDate(posting.createdAt),
  };
}
