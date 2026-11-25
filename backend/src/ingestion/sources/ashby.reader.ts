import { Injectable } from '@nestjs/common';
import { HttpClient } from '../../common/http/http-client.js';
import { Ats, JobSource } from '../../generated/prisma/enums.js';
import { compact, requestOptions, toDate } from './reader-helpers.js';
import { ashbyJobBoardSchema, parseResponse, type AshbyJob } from './schemas.js';
import type { BoardRead, BoardReader, RawJob, ReadOptions } from './source.types.js';

// Ashby posting API (docs/ARCHITECTURE.md §3.3). Unlisted jobs are skipped. Ashby gives a
// country name ("USA", "United States"), not an ISO code; the pipeline resolves it.
@Injectable()
export class AshbyReader implements BoardReader {
  readonly ats = Ats.ASHBY;

  constructor(private readonly http: HttpClient) {}

  async read(slug: string, opts: ReadOptions = {}): Promise<BoardRead> {
    const url = `https://api.ashbyhq.com/posting-api/job-board/${encodeURIComponent(slug)}`;
    const data = parseResponse(
      ashbyJobBoardSchema,
      await this.http.getJson(url, requestOptions(opts)),
      url,
    );

    const jobs = data.jobs.filter((job) => job.isListed).map((job) => toRawJob(job));
    return { jobs, truncated: false };
  }
}

function toRawJob(job: AshbyJob): RawJob {
  return {
    source: JobSource.ASHBY,
    externalId: job.id,
    title: job.title,
    locations: compact([job.location, ...(job.secondaryLocations ?? []).map((s) => s.location)]),
    countryCodes: compact([job.address?.postalAddress?.addressCountry]),
    workModeHint: job.workplaceType ?? (job.isRemote ? 'remote' : undefined),
    url: job.jobUrl,
    postedAt: toDate(job.publishedAt),
  };
}
