import { readFileSync } from 'node:fs';
import type { TestingModule } from '@nestjs/testing';
import type { ConfigService } from '@nestjs/config';
import { JobStoreService } from '../src/ingestion/job-store.service.js';
import { LinkedInApifyLaneService } from '../src/ingestion/linkedin-apify.service.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { createTestingApp, resetDb } from './helpers/db.js';

const NOW = new Date('2026-11-26T06:00:00Z'); // 11:30 IST
const LATER = new Date(Date.now() + 60 * 60_000);
const items = JSON.parse(
  readFileSync(new URL('./fixtures/apify-linkedin.json', import.meta.url), 'utf8'),
) as unknown[];

/** A fake Apify API: the run starts RUNNING, finishes on the first status check (unless stuck). */
function fakeApify(opts: { stuck?: boolean } = {}) {
  const run = (status: string) => ({
    data: { id: 'run1', status, defaultDatasetId: 'ds1', usageTotalUsd: 0.006 },
  });
  return {
    postJson: vi.fn(async (url: string, _body: unknown, _opts?: unknown) =>
      url.endsWith('/abort') ? run('ABORTED') : run('RUNNING'),
    ),
    getJson: vi.fn(async (url: string, _opts?: unknown) => {
      if (url.includes('/actor-runs/')) return run(opts.stuck ? 'RUNNING' : 'SUCCEEDED');
      if (url.includes('/datasets/')) return items;
      throw new Error(`unexpected ${url}`);
    }),
  };
}

function config(overrides: Record<string, unknown> = {}): ConfigService {
  const values: Record<string, unknown> = {
    APIFY_TOKEN: 'test-token',
    APIFY_LINKEDIN_DAILY_LIMIT: 50,
    APIFY_MAX_COST_USD: 0.15,
    MAX_JOB_AGE_DAYS: 30,
    TARGET_COUNTRIES: [],
    ...overrides,
  };
  return { get: (key: string) => values[key] } as ConfigService;
}

describe('LinkedInApifyLaneService (integration, real PostgreSQL, fake Apify)', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let store: JobStoreService;

  beforeAll(async () => {
    moduleRef = await createTestingApp([JobStoreService]);
    prisma = moduleRef.get(PrismaService);
    store = moduleRef.get(JobStoreService);
  });

  afterAll(async () => {
    await moduleRef.close();
  });

  beforeEach(async () => {
    await resetDb(prisma);
  });

  const lane = (http: unknown, cfg = config()) =>
    new LinkedInApifyLaneService(http as never, store, prisma, cfg);

  it('starts one capped run, waits, and saves the jobs it returns', async () => {
    const http = fakeApify();
    const stats = await lane(http).run({ now: NOW, deadline: LATER, windowSeconds: 86400 });

    const [startUrl, input, startOpts] = http.postJson.mock.calls[0]!;
    expect(startUrl).toContain('/acts/curious_coder~linkedin-jobs-scraper/runs?');
    expect(startUrl).toContain('maxItems=50');
    expect(startUrl).toContain('maxTotalChargeUsd=0.15');
    expect(startOpts).toMatchObject({
      maxAttempts: 1, // never retried: a retry could start a second paid run
      headers: { authorization: 'Bearer test-token' },
    });
    expect(input).toMatchObject({ limitPerSource: 17, scrapeCompany: false });
    expect(startUrl).not.toContain('test-token'); // the token goes in a header, not the URL

    expect(stats).toMatchObject({
      provider: 'apify',
      requests: 1,
      cards: 4,
      new: 3,
      errors: 1, // the item without a title
      costUsd: 0.006,
    });
    const jobs = await prisma.job.findMany({ orderBy: { externalId: 'asc' } });
    expect(jobs.map((j) => [j.externalId, j.source, j.country, j.url])).toEqual([
      ['4330222739', 'LINKEDIN', 'IN', 'https://www.linkedin.com/jobs/view/4330222739'],
      ['4331000001', 'LINKEDIN', 'AE', 'https://www.linkedin.com/jobs/view/4331000001'],
      ['4331000002', 'LINKEDIN', 'US', 'https://www.linkedin.com/jobs/view/4331000002'],
    ]);
  });

  it('takes only what is left of today’s limit', async () => {
    await prisma.fetchRun.create({
      data: {
        status: 'SUCCESS',
        startedAt: new Date('2026-11-26T01:00:00Z'), // 06:30 IST today
        stats: { linkedin: { provider: 'apify', cards: 30 } },
      },
    });
    const http = fakeApify();
    await lane(http).run({ now: NOW, deadline: LATER, windowSeconds: 86400 });
    expect(http.postJson.mock.calls[0]![0]).toContain('maxItems=20');
  });

  it('starts no run once today’s limit is used (yesterday’s runs don’t count)', async () => {
    await prisma.fetchRun.createMany({
      data: [
        {
          status: 'SUCCESS',
          startedAt: new Date('2026-11-26T01:00:00Z'),
          stats: { linkedin: { provider: 'apify', cards: 50 } },
        },
        {
          status: 'SUCCESS',
          startedAt: new Date('2026-11-25T01:00:00Z'),
          stats: { linkedin: { provider: 'apify', cards: 50 } },
        },
      ],
    });
    const http = fakeApify();
    const stats = await lane(http).run({ now: NOW, deadline: LATER, windowSeconds: 86400 });
    expect(stats.dailyLimitReached).toBe(true);
    expect(http.postJson).not.toHaveBeenCalled();
  });

  it('does nothing without a token', async () => {
    const http = fakeApify();
    const stats = await lane(http, config({ APIFY_TOKEN: undefined })).run({
      now: NOW,
      deadline: LATER,
      windowSeconds: 86400,
    });
    expect(stats.errors).toBe(1);
    expect(http.postJson).not.toHaveBeenCalled();
  });

  it('stops a run that is still going at the deadline, and keeps what it found', async () => {
    const http = fakeApify({ stuck: true });
    const stats = await lane(http).run({
      now: NOW,
      deadline: new Date(Date.now() - 1),
      windowSeconds: 86400,
    });
    expect(http.postJson.mock.calls.map(([url]) => url.endsWith('/abort'))).toEqual([false, true]);
    expect(stats.new).toBe(3);
    expect(stats.errors).toBe(2); // the bad item, and the run that didn't finish
  });
});
