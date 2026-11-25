import type { TestingModule } from '@nestjs/testing';
import type { HttpClient } from '../src/common/http/http-client.js';
import { JobStoreService } from '../src/ingestion/job-store.service.js';
import { LinkedInLaneService } from '../src/ingestion/linkedin-lane.service.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { createTestingApp, resetDb } from './helpers/db.js';

const card = (id: string, title: string, company: string, slug: string, location: string) => `
  <li><div class="base-card" data-entity-urn="urn:li:jobPosting:${id}">
    <h3 class="base-search-card__title">${title}</h3>
    <h4 class="base-search-card__subtitle"><a href="https://in.linkedin.com/company/${slug}?trk=x">${company}</a></h4>
    <span class="job-search-card__location">${location}</span>
    <time datetime="2026-11-24"></time></div></li>`;

const pages: Record<string, string[]> = {
  'Chennai, Tamil Nadu, India': [
    card(
      '4330000001',
      'Recruiter - Bulk Hiring',
      'Kestrel Staffing Pvt. Ltd.',
      'kestrel-staffing',
      'Chennai, Tamil Nadu, India',
    ) +
      card(
        '4330000002',
        'Sales Executive',
        'Brightpath Health',
        'brightpath',
        'Chennai, Tamil Nadu, India',
      ),
  ],
  'Dubai, United Arab Emirates': [
    card(
      '4330000003',
      'Account Manager',
      'Kestrel Staffing Private Limited',
      'kestrel-staffing',
      'Dubai, United Arab Emirates',
    ),
  ],
};

describe('LinkedInLaneService (integration, real PostgreSQL)', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let lane: LinkedInLaneService;
  const searches = [
    { location: 'Chennai, Tamil Nadu, India', country: 'IN' as const, priority: 1 },
    { location: 'Dubai, United Arab Emirates', country: 'AE' as const, priority: 1 },
  ];

  beforeAll(async () => {
    moduleRef = await createTestingApp([JobStoreService]);
    prisma = moduleRef.get(PrismaService);
    const calls = new Map<string, number>();
    const http = {
      getText: async (url: string) => {
        const location = new URL(url).searchParams.get('location')!;
        const n = calls.get(location) ?? 0;
        calls.set(location, n + 1);
        return pages[location]?.[n % 2 === 0 ? 0 : 99] ?? ''; // page 1, then the empty end page
      },
    };
    const values: Record<string, unknown> = {
      LINKEDIN_ENABLED: true,
      LINKEDIN_MAX_REQUESTS: 50,
      TARGET_COUNTRIES: ['IN', 'AE', 'US'],
      MAX_JOB_AGE_DAYS: 30,
    };
    lane = new LinkedInLaneService(http as unknown as HttpClient, moduleRef.get(JobStoreService), {
      get: (k: string) => values[k],
    } as never);
  });

  beforeEach(async () => {
    await resetDb(prisma);
  });

  afterAll(async () => {
    await moduleRef.close();
  });

  it('saves LinkedIn jobs once, merges company spellings, and a second run adds nothing', async () => {
    const now = new Date('2026-11-25T00:40:00Z');
    const first = await lane.run({
      now,
      deadline: new Date('2100-01-01'),
      windowSeconds: 86_400,
      searches,
    });
    expect(first).toMatchObject({ new: 3, blocked: false, errors: 0 });

    const companies = await prisma.company.findMany({ orderBy: { normalizedName: 'asc' } });
    expect(companies.map((c) => [c.normalizedName, c.discoveredVia, c.linkedinUrl])).toEqual([
      ['brightpath health', 'linkedin', 'https://www.linkedin.com/company/brightpath'],
      ['kestrel staffing', 'linkedin', 'https://www.linkedin.com/company/kestrel-staffing'],
    ]);
    const jobs = await prisma.job.findMany({ orderBy: { externalId: 'asc' } });
    expect(jobs.map((j) => [j.externalId, j.country, j.source, j.boardId])).toEqual([
      ['4330000001', 'IN', 'LINKEDIN', null],
      ['4330000002', 'IN', 'LINKEDIN', null],
      ['4330000003', 'AE', 'LINKEDIN', null],
    ]);

    const second = await lane.run({
      now: new Date('2026-11-26T00:40:00Z'),
      deadline: new Date('2100-01-01'),
      windowSeconds: 86_400,
      searches,
    });
    expect(second.new).toBe(0);
    expect(await prisma.job.count()).toBe(3);
  });
});
