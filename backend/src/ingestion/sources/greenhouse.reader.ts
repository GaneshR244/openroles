import { Injectable } from '@nestjs/common';
import { HttpClient } from '../../common/http/http-client.js';
import { Ats, JobSource } from '../../generated/prisma/enums.js';
import { compact, requestOptions, toDate } from './reader-helpers.js';
import { greenhouseJobsSchema, parseResponse, type GreenhouseJob } from './schemas.js';
import type { BoardRead, BoardReader, RawJob, ReadOptions } from './source.types.js';

// Greenhouse job board API (docs/ARCHITECTURE.md §3.3). One request, no paging.
// Without content=true the response has no descriptions, which keeps it small.
@Injectable()
export class GreenhouseReader implements BoardReader {
  readonly ats = Ats.GREENHOUSE;

  constructor(private readonly http: HttpClient) {}

  async read(slug: string, opts: ReadOptions = {}): Promise<BoardRead> {
    const url = `https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(slug)}/jobs`;
    const data = parseResponse(
      greenhouseJobsSchema,
      await this.http.getJson(url, requestOptions(opts)),
      url,
    );

    const jobs = data.jobs.map((job) => toRawJob(job));
    return { jobs, truncated: false };
  }
}

function toRawJob(job: GreenhouseJob): RawJob {
  return {
    source: JobSource.GREENHOUSE,
    externalId: String(job.id),
    title: job.title,
    companyName: job.company_name ?? undefined,
    locations: compact([job.location?.name]),
    countryCodes: [],
    url: job.absolute_url,
    postedAt: toDate(job.first_published ?? job.updated_at),
  };
}
