import { Controller, Get, Header, Param, Query } from '@nestjs/common';
import { JobsService } from './jobs.service.js';
import { companyIdSchema, jobQuerySchema, type JobQuery } from './jobs.schemas.js';
import type {
  CompanyItem,
  CountryCount,
  JobItem,
  JobSummary,
  Paged,
  RunSummary,
} from './jobs.types.js';

// Read-only API for the sales page. All routes need x-api-key (global ApiKeyGuard).
// Data changes once a day, so short private caching is safe.

const CACHE = 'private, max-age=60';

@Controller()
export class JobsController {
  constructor(private readonly jobs: JobsService) {}

  @Get('jobs')
  @Header('Cache-Control', CACHE)
  list(@Query({ schema: jobQuerySchema }) query: JobQuery): Promise<Paged<JobItem>> {
    return this.jobs.listJobs(query);
  }

  @Get('companies')
  @Header('Cache-Control', CACHE)
  companies(@Query({ schema: jobQuerySchema }) query: JobQuery): Promise<Paged<CompanyItem>> {
    return this.jobs.listCompanies(query);
  }

  @Get('companies/:id/jobs')
  @Header('Cache-Control', CACHE)
  companyJobs(
    @Param('id', { schema: companyIdSchema }) id: string,
  ): Promise<{ company: CompanyItem; jobs: JobItem[] }> {
    return this.jobs.companyJobs(id);
  }

  @Get('summary')
  @Header('Cache-Control', CACHE)
  summary(@Query({ schema: jobQuerySchema }) query: JobQuery): Promise<JobSummary> {
    return this.jobs.summary(query);
  }

  @Get('countries')
  @Header('Cache-Control', CACHE)
  countries(): Promise<CountryCount[]> {
    return this.jobs.countries();
  }

  @Get('runs/latest')
  @Header('Cache-Control', 'private, max-age=30')
  latestRun(): Promise<RunSummary> {
    return this.jobs.latestRun();
  }
}
