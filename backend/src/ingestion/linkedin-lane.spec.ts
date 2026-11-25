import { RateLimitedError, HttpError } from '../common/http/errors.js';
import type { HttpClient } from '../common/http/http-client.js';
import type { JobStoreService } from './job-store.service.js';
import { LinkedInLaneService, firstPassShare, searchUrl } from './linkedin-lane.service.js';
import type { LinkedInSearch } from './sources.config.js';
import type { PreparedBatch } from './pipeline/pipeline.types.js';

const NOW = new Date('2026-11-25T00:40:00Z');
const FAR = new Date('2100-01-01T00:00:00Z');

/** One search-result page with the given job IDs. */
function page(ids: string[], location = 'Chennai, Tamil Nadu, India'): string {
  return ids
    .map(
      (id) => `<li><div class="base-card" data-entity-urn="urn:li:jobPosting:${id}">
        <h3 class="base-search-card__title">Role ${id}</h3>
        <h4 class="base-search-card__subtitle"><a href="https://in.linkedin.com/company/co-${id}">Company ${id}</a></h4>
        <span class="job-search-card__location">${location}</span>
        <time datetime="2026-11-24"></time></div></li>`,
    )
    .join('\n');
}

/** Numeric LinkedIn-style IDs: base 1 → 1000000, 1000001, … */
const ids = (base: number, from: number, n: number) =>
  Array.from({ length: n }, (_, i) => String(base * 1_000_000 + from + i));

/** Fake LinkedIn: pages[location] is the list of result pages for that search. */
function setup(pages: Record<string, (string | Error)[]>, env: Record<string, unknown> = {}) {
  const requested: { location: string; start: number }[] = [];
  const http = {
    getText: vi.fn(async (url: string) => {
      const u = new URL(url);
      const location = u.searchParams.get('location')!;
      const start = Number(u.searchParams.get('start'));
      const index = requested.filter((r) => r.location === location).length;
      requested.push({ location, start });
      const next = pages[location]?.[index];
      if (next instanceof Error) throw next;
      return next ?? '';
    }),
  };
  const batches: PreparedBatch[] = [];
  const store = {
    saveBatch: vi.fn(async (batch: PreparedBatch) => {
      batches.push(batch);
      return { touched: 0, inserted: batch.kept.length, newCompanies: 0 };
    }),
  };
  const values: Record<string, unknown> = {
    LINKEDIN_ENABLED: true,
    LINKEDIN_MAX_REQUESTS: 300,
    TARGET_COUNTRIES: ['IN', 'AE', 'US'],
    MAX_JOB_AGE_DAYS: 30,
    ...env,
  };
  const config = { get: (key: string) => values[key] };
  const lane = new LinkedInLaneService(
    http as unknown as HttpClient,
    store as unknown as JobStoreService,
    config as never,
  );
  return { lane, http, store, batches, requested };
}

const search = (
  location: string,
  country: 'IN' | 'AE' | 'US' = 'IN',
  priority = 1,
): LinkedInSearch => ({
  location,
  country,
  priority,
});

describe('LinkedInLaneService', () => {
  it('does nothing when LINKEDIN_ENABLED is off', async () => {
    const { lane, http } = setup({}, { LINKEDIN_ENABLED: false });
    const stats = await lane.run({
      now: NOW,
      deadline: FAR,
      windowSeconds: 86_400,
      searches: [search('A')],
    });
    expect(stats.enabled).toBe(false);
    expect(http.getText).not.toHaveBeenCalled();
  });

  it('builds the logged-out search URL with the posted-since window', () => {
    const url = new URL(searchUrl('Dubai, United Arab Emirates', 90_000, 20));
    expect(url.origin + url.pathname).toBe(
      'https://www.linkedin.com/jobs-guest/jobs/api/seeMoreJobPostings/search',
    );
    expect(Object.fromEntries(url.searchParams)).toEqual({
      keywords: '',
      location: 'Dubai, United Arab Emirates',
      f_TPR: 'r90000',
      start: '20',
    });
  });

  it('shares the request budget fairly, then gives leftovers to busy cities', async () => {
    expect(firstPassShare(300, 20)).toBe(15);
    expect(firstPassShare(5, 20)).toBe(1);
    const { lane, requested } = setup(
      {
        A: [
          page(ids(1, 0, 10)),
          page(ids(1, 10, 10)),
          page(ids(1, 20, 10)),
          page(ids(1, 30, 10)),
        ],
        B: [page(ids(2, 0, 10)), ''],
        C: [page(ids(3, 0, 10)), page(ids(3, 10, 10)), page(ids(3, 20, 10))],
      },
      { LINKEDIN_MAX_REQUESTS: 8 },
    );
    const stats = await lane.run({
      now: NOW,
      deadline: FAR,
      windowSeconds: 86_400,
      searches: [search('A'), search('B'), search('C')],
    });
    // pass 1: 2 requests each (B's second is the empty end page); pass 2: A gets the last 2
    expect(requested.map((r) => `${r.location}${r.start}`)).toEqual([
      'A0',
      'A10',
      'B0',
      'B10',
      'C0',
      'C10',
      'A20',
      'A30',
    ]);
    expect(stats).toMatchObject({ requests: 8, cards: 70, blocked: false });
  });

  it('skips a posting already seen in another city search, and tags the search country', async () => {
    const { lane, batches } = setup({
      'Dubai, United Arab Emirates': [page(['1', '2'], 'Dubai, United Arab Emirates')],
      'Abu Dhabi, United Arab Emirates': [page(['2', '3'], 'Abu Dhabi, United Arab Emirates')],
    });
    const stats = await lane.run({
      now: NOW,
      deadline: FAR,
      windowSeconds: 86_400,
      searches: [
        search('Dubai, United Arab Emirates', 'AE'),
        search('Abu Dhabi, United Arab Emirates', 'AE'),
      ],
    });
    const kept = batches.flatMap((b) => b.kept);
    expect(kept.map((j) => j.externalId).sort()).toEqual(['1', '2', '3']);
    expect(kept.every((j) => j.country === 'AE')).toBe(true);
    expect(stats.new).toBe(3);
  });

  it('stops everything when LinkedIn blocks us (rate limit or bot-check page)', async () => {
    const rateLimited = setup({
      A: [new RateLimitedError('https://www.linkedin.com/x', 60_000)],
      B: [page(['1'])],
    });
    const s1 = await rateLimited.lane.run({
      now: NOW,
      deadline: FAR,
      windowSeconds: 86_400,
      searches: [search('A'), search('B')],
    });
    expect(s1.blocked).toBe(true);
    expect(rateLimited.requested).toHaveLength(1);

    const botCheck = setup({ A: ['<html><script>var _0x1a=1;</script></html>'], B: [page(['1'])] });
    const s2 = await botCheck.lane.run({
      now: NOW,
      deadline: FAR,
      windowSeconds: 86_400,
      searches: [search('A'), search('B')],
    });
    expect(s2.blocked).toBe(true);
    expect(botCheck.requested).toHaveLength(1);
  });

  it('treats a 400 past the first page as the end of results, but counts other errors', async () => {
    const { lane } = setup({
      A: [page(ids(1, 0, 10)), new HttpError('http_error', 'https://x', 'bad request', 400)],
      B: [new HttpError('http_error', 'https://x', 'forbidden', 403)],
    });
    const stats = await lane.run({
      now: NOW,
      deadline: FAR,
      windowSeconds: 86_400,
      searches: [search('A'), search('B')],
    });
    expect(stats).toMatchObject({ errors: 1, blocked: false, cards: 10 });
  });

  it('marks a search saturated at about 1,000 results and saves in batches of 100', async () => {
    const pages = Array.from({ length: 120 }, (_, p) => page(ids(4, p * 10, 10)));
    const { lane, store } = setup({ A: pages }, { LINKEDIN_MAX_REQUESTS: 500 });
    const stats = await lane.run({
      now: NOW,
      deadline: FAR,
      windowSeconds: 86_400,
      searches: [search('A')],
    });
    expect(stats.requests).toBe(100);
    expect(stats.saturated).toEqual(['A']);
    expect(store.saveBatch).toHaveBeenCalledTimes(10);
    expect(stats.new).toBe(1000);
  });

  it('skips searches for countries outside TARGET_COUNTRIES and stops at the deadline', async () => {
    const { lane, requested } = setup(
      { A: [page(['1'])], B: [page(['2'])] },
      { TARGET_COUNTRIES: ['IN'] },
    );
    await lane.run({
      now: NOW,
      deadline: FAR,
      windowSeconds: 86_400,
      searches: [search('A', 'US'), search('B', 'IN')],
    });
    expect(requested.map((r) => r.location)).toEqual(['B', 'B']);

    const late = setup({ A: [page(['1'])] });
    const stats = await late.lane.run({
      now: NOW,
      deadline: new Date(0),
      windowSeconds: 86_400,
      searches: [search('A')],
    });
    expect(stats.requests).toBe(0);
  });
});
