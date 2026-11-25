import { readFileSync } from 'node:fs';
import { SchemaChangedError } from '../../common/http/errors.js';
import type { HttpClient } from '../../common/http/http-client.js';
import { SmartRecruitersReader } from './smartrecruiters.reader.js';

// Real first page from api.smartrecruiters.com/v1/companies/Freshworks/postings (25 Nov 2026),
// trimmed to 15 postings, so totalFound is 15 here.
const fixture = () =>
  JSON.parse(
    readFileSync(new URL('../../../test/fixtures/smartrecruiters.json', import.meta.url), 'utf8'),
  );

const BASE = 'https://api.smartrecruiters.com/v1/companies/Freshworks/postings';

/** A synthetic page of `count` postings cloned from the fixture, with unique ids. */
function page(offset: number, count: number, totalFound: number) {
  const template = fixture().content[0];
  const content = Array.from({ length: count }, (_, i) => ({
    ...template,
    id: `id-${offset + i}`,
  }));
  return { offset, limit: 100, totalFound, content };
}

function setup() {
  const http = { getJson: vi.fn(), postJson: vi.fn(), getText: vi.fn() };
  return { http, reader: new SmartRecruitersReader(http as unknown as HttpClient) };
}

describe('SmartRecruitersReader', () => {
  it('reads a single page from the fixture', async () => {
    const { http, reader } = setup();
    http.getJson.mockResolvedValueOnce(fixture());

    const { jobs, truncated } = await reader.read('Freshworks');

    expect(http.getJson.mock.calls.map((c) => c[0])).toEqual([`${BASE}?limit=100&offset=0`]);
    expect(jobs).toHaveLength(15);
    expect(truncated).toBe(false);
    expect(jobs[0]).toEqual({
      source: 'SMARTRECRUITERS',
      externalId: '744000163610179',
      title: 'Senior Staff Product Manager',
      companyName: 'Freshworks',
      locations: ['Chennai, , India'], // fullLocation as given
      countryCodes: ['in'],
      workModeHint: 'hybrid',
      url: 'https://jobs.smartrecruiters.com/Freshworks/744000163610179',
      postedAt: new Date('2026-11-25T05:38:36.601Z'),
    });
  });

  it('pages by offset until totalFound', async () => {
    const { http, reader } = setup();
    http.getJson.mockResolvedValueOnce(page(0, 100, 120)).mockResolvedValueOnce(page(100, 20, 120));

    const { jobs, truncated } = await reader.read('Freshworks');

    expect(http.getJson.mock.calls.map((c) => c[0])).toEqual([
      `${BASE}?limit=100&offset=0`,
      `${BASE}?limit=100&offset=100`,
    ]);
    expect(jobs).toHaveLength(120);
    expect(truncated).toBe(false);
    expect(new Set(jobs.map((j) => j.externalId)).size).toBe(120);
  });

  it('returns [] when totalFound is 0 (unknown company)', async () => {
    const { http, reader } = setup();
    http.getJson.mockResolvedValueOnce({ offset: 0, limit: 100, totalFound: 0, content: [] });

    await expect(reader.read('Nope')).resolves.toEqual({ jobs: [], truncated: false });
    expect(http.getJson).toHaveBeenCalledTimes(1);
  });

  it('stops at maxPages (default 20) and marks the read truncated', async () => {
    const { http, reader } = setup();
    http.getJson.mockImplementation(async (url: string) => {
      const offset = Number(new URL(url).searchParams.get('offset'));
      return page(offset, 100, 100_000);
    });

    const probe = await reader.read('Freshworks', { maxPages: 1 });
    expect(probe.jobs).toHaveLength(100);
    expect(probe.truncated).toBe(true);
    expect(http.getJson).toHaveBeenCalledTimes(1);

    http.getJson.mockClear();
    const full = await reader.read('Freshworks');
    expect(full.jobs).toHaveLength(2_000);
    expect(full.truncated).toBe(true);
    expect(http.getJson).toHaveBeenCalledTimes(20);
  });

  it('is not truncated when the last allowed page finishes the board', async () => {
    const { http, reader } = setup();
    http.getJson
      .mockResolvedValueOnce(page(0, 100, 200))
      .mockResolvedValueOnce(page(100, 100, 200));

    const read = await reader.read('Freshworks', { maxPages: 2 });
    expect(read.jobs).toHaveLength(200);
    expect(read.truncated).toBe(false);
  });

  it('stops on an empty page before totalFound and reports the list as truncated', async () => {
    const { http, reader } = setup();
    http.getJson.mockResolvedValueOnce(page(0, 100, 500)).mockResolvedValueOnce(page(100, 0, 500));

    const { jobs, truncated } = await reader.read('Freshworks');
    expect(jobs).toHaveLength(100);
    expect(truncated).toBe(true);
    expect(http.getJson).toHaveBeenCalledTimes(2);
  });

  it('maps work mode flags and builds a location from city and country', async () => {
    const { http, reader } = setup();
    const data = fixture();
    data.content[0].location = { city: 'Dubai', country: 'ae', remote: true, hybrid: false };
    data.content[1].location = { ...data.content[1].location, remote: false, hybrid: false };
    http.getJson.mockResolvedValueOnce(data);

    const {
      jobs: [first, second],
    } = await reader.read('Freshworks');
    expect(first.locations).toEqual(['Dubai, ae']);
    expect(first.workModeHint).toBe('remote');
    expect(second.workModeHint).toBe('onsite');
  });

  it('throws SchemaChangedError on a broken payload', async () => {
    const { http, reader } = setup();
    http.getJson.mockResolvedValueOnce({ offset: 0, limit: 100, content: [] });

    const error = await reader.read('Freshworks').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(SchemaChangedError);
    expect((error as SchemaChangedError).reason).toMatch(/^totalFound/);
  });
});
