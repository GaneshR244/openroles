import { readFileSync } from 'node:fs';
import { NotFoundError, SchemaChangedError } from '../../common/http/errors.js';
import type { HttpClient } from '../../common/http/http-client.js';
import { WorkableReader } from './workable.reader.js';

// Real first page from POST apply.workable.com/api/v3/accounts/huggingface/jobs (25 Nov 2026).
// The board has exactly 10 jobs: page 1 is full, so it carries a nextPage token, and the live
// second page (token in the body) came back as { total: 10, results: [] } with no nextPage.
const fixture = () =>
  JSON.parse(
    readFileSync(new URL('../../../test/fixtures/workable.json', import.meta.url), 'utf8'),
  );

const URL_HF = 'https://apply.workable.com/api/v3/accounts/huggingface/jobs';
const SEARCH_ALL = { query: '', location: [], department: [], worktype: [], remote: [] };
const TOKEN = 'WzE3MjkxMjMyMDAwMDAsMjc2OTUwNV0=';

function setup() {
  const http = { getJson: vi.fn(), postJson: vi.fn(), getText: vi.fn() };
  return { http, reader: new WorkableReader(http as unknown as HttpClient) };
}

describe('WorkableReader', () => {
  it('reads the fixture and follows nextPage with a token in the body', async () => {
    const { http, reader } = setup();
    http.postJson
      .mockResolvedValueOnce(fixture())
      .mockResolvedValueOnce({ total: 10, results: [] });

    const { jobs, truncated } = await reader.read('huggingface');

    expect(truncated).toBe(false);
    expect(http.postJson.mock.calls.map((c) => [c[0], c[1]])).toEqual([
      [URL_HF, SEARCH_ALL],
      [URL_HF, { ...SEARCH_ALL, token: TOKEN }],
    ]);
    expect(jobs).toHaveLength(10);
    expect(jobs[0]).toEqual({
      source: 'WORKABLE',
      externalId: '2F83B48969',
      title: 'Senior Software Engineer, Bot Detection (Client-Side & Signals) - EMEA Remote',
      locations: ['France'],
      countryCodes: ['FR'],
      workModeHint: 'remote',
      url: 'https://apply.workable.com/huggingface/j/2F83B48969/',
      postedAt: new Date('2026-11-20T00:00:00.000Z'),
    });
    expect(jobs[1].locations).toEqual(['New York, United States']); // city = region, kept once
    expect(jobs[1].countryCodes).toEqual(['US']);
  });

  it('reads a synthetic second page and stops when nextPage is absent', async () => {
    const { http, reader } = setup();
    const first = fixture();
    const second = { total: 11, results: [{ ...first.results[0], shortcode: 'EXTRA00001' }] };
    http.postJson.mockResolvedValueOnce(first).mockResolvedValueOnce(second);

    const { jobs, truncated } = await reader.read('huggingface');

    expect(http.postJson).toHaveBeenCalledTimes(2);
    expect(jobs).toHaveLength(11);
    expect(truncated).toBe(false);
    expect(jobs[10].url).toBe('https://apply.workable.com/huggingface/j/EXTRA00001/');
  });

  it('stops at maxPages (default 50) and marks the read truncated', async () => {
    const { http, reader } = setup();
    let n = 0;
    http.postJson.mockImplementation(async () => ({
      ...fixture(),
      total: 1_000,
      nextPage: `t${n++}`,
    }));

    const probe = await reader.read('huggingface', { maxPages: 1 });
    expect(probe.jobs).toHaveLength(10);
    expect(probe.truncated).toBe(true);
    expect(http.postJson).toHaveBeenCalledTimes(1);

    http.postJson.mockClear();
    const full = await reader.read('huggingface');
    expect(full.jobs).toHaveLength(500);
    expect(full.truncated).toBe(true);
    expect(http.postJson).toHaveBeenCalledTimes(50);
  });

  it('is not truncated at the cap when total says every job was read', async () => {
    const { http, reader } = setup();
    http.postJson.mockResolvedValueOnce(fixture()); // total 10, 10 results, nextPage set

    const read = await reader.read('huggingface', { maxPages: 1 });
    expect(read.jobs).toHaveLength(10);
    expect(read.truncated).toBe(false);
  });

  it('stops on a repeated token', async () => {
    const { http, reader } = setup();
    http.postJson.mockImplementation(async () => ({ ...fixture(), nextPage: 'same' }));

    const read = await reader.read('huggingface');
    expect(http.postJson).toHaveBeenCalledTimes(2);
    expect(read.truncated).toBe(false);
  });

  it('uses location when locations is empty and merges country codes', async () => {
    const { http, reader } = setup();
    const data = fixture();
    data.nextPage = null;
    data.results[0].locations = [];
    data.results[0].location = { city: 'Dubai', region: null, country: 'UAE', countryCode: 'AE' };
    data.results[1].locations.push({ city: 'Pune', country: 'India', countryCode: 'IN' });
    delete data.results[2].workplace;
    http.postJson.mockResolvedValueOnce(data);

    const {
      jobs: [first, second, third],
    } = await reader.read('huggingface');
    expect(first.locations).toEqual(['Dubai, UAE']);
    expect(first.countryCodes).toEqual(['AE']);
    expect(second.locations).toEqual(['New York, United States', 'Pune, India']);
    expect(second.countryCodes).toEqual(['US', 'IN']);
    expect(third.workModeHint).toBe('remote'); // from remote: true
  });

  it('passes timeout and attempts through and lets NotFoundError out', async () => {
    const { http, reader } = setup();
    http.postJson.mockRejectedValueOnce(new NotFoundError(URL_HF));

    await expect(
      reader.read('huggingface', { timeoutMs: 3_000, maxAttempts: 1 }),
    ).rejects.toBeInstanceOf(NotFoundError);
    expect(http.postJson.mock.calls[0][2]).toEqual({ timeoutMs: 3_000, maxAttempts: 1 });
  });

  it('throws SchemaChangedError on a broken payload', async () => {
    const { http, reader } = setup();
    const data = fixture();
    delete data.results[3].shortcode;
    http.postJson.mockResolvedValueOnce(data);

    const error = await reader.read('huggingface').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(SchemaChangedError);
    expect((error as SchemaChangedError).reason).toMatch(/^results\.3\.shortcode/);
  });
});
