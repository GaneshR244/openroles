import { readFileSync } from 'node:fs';
import { NotFoundError, SchemaChangedError, ServerError } from '../../common/http/errors.js';
import type { HttpClient } from '../../common/http/http-client.js';
import { LeverReader } from './lever.reader.js';

// Real response from api.lever.co/v0/postings/cred?mode=json (25 Nov 2026), descriptions trimmed.
const fixture = () =>
  JSON.parse(readFileSync(new URL('../../../test/fixtures/lever.json', import.meta.url), 'utf8'));

const GLOBAL = 'https://api.lever.co/v0/postings/cred?mode=json';
const EU = 'https://api.eu.lever.co/v0/postings/cred?mode=json';

function setup() {
  const http = { getJson: vi.fn(), postJson: vi.fn(), getText: vi.fn() };
  return { http, reader: new LeverReader(http as unknown as HttpClient) };
}

describe('LeverReader', () => {
  it('reads every posting from the fixture', async () => {
    const { http, reader } = setup();
    http.getJson.mockResolvedValueOnce(fixture());

    const { jobs, truncated } = await reader.read('cred');

    expect(truncated).toBe(false);

    expect(http.getJson.mock.calls.map((c) => c[0])).toEqual([GLOBAL]);
    expect(jobs).toHaveLength(11);
    expect(jobs[0]).toEqual({
      source: 'LEVER',
      externalId: 'af4cc539-ea8b-4405-8067-2d7d729c9759',
      title: 'area collections manager chennai- flows',
      locations: ['tamil nadu'],
      countryCodes: ['IN'],
      workModeHint: 'onsite',
      url: 'https://jobs.lever.co/cred/af4cc539-ea8b-4405-8067-2d7d729c9759',
      postedAt: new Date(1787308401605),
    });
    expect(jobs[0].companyName).toBeUndefined();
  });

  it('retries on the EU host after a 404', async () => {
    const { http, reader } = setup();
    http.getJson.mockRejectedValueOnce(new NotFoundError(GLOBAL)).mockResolvedValueOnce(fixture());

    const { jobs } = await reader.read('cred', { timeoutMs: 3_000 });

    expect(http.getJson.mock.calls.map((c) => c[0])).toEqual([GLOBAL, EU]);
    expect(http.getJson.mock.calls[1][1]).toEqual({ timeoutMs: 3_000, maxAttempts: undefined });
    expect(jobs).toHaveLength(11);
  });

  it('throws NotFoundError when both hosts answer 404', async () => {
    const { http, reader } = setup();
    http.getJson
      .mockRejectedValueOnce(new NotFoundError(GLOBAL))
      .mockRejectedValueOnce(new NotFoundError(EU));

    const error = await reader.read('cred').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(NotFoundError);
    expect((error as NotFoundError).url).toBe(EU);
  });

  it('does not try the EU host for other errors', async () => {
    const { http, reader } = setup();
    http.getJson.mockRejectedValueOnce(new ServerError(GLOBAL, 503));

    await expect(reader.read('cred')).rejects.toBeInstanceOf(ServerError);
    expect(http.getJson).toHaveBeenCalledTimes(1);
  });

  it('falls back to categories.location and leaves missing fields empty', async () => {
    const { http, reader } = setup();
    const data = fixture();
    delete data[0].categories.allLocations;
    delete data[0].country;
    delete data[0].workplaceType;
    http.getJson.mockResolvedValueOnce(data);

    const {
      jobs: [job],
    } = await reader.read('cred');
    expect(job.locations).toEqual(['tamil nadu']);
    expect(job.countryCodes).toEqual([]);
    expect(job.workModeHint).toBeUndefined();
  });

  it('throws SchemaChangedError on a broken payload', async () => {
    const { http, reader } = setup();
    http.getJson.mockResolvedValueOnce({ postings: [] });

    await expect(reader.read('cred')).rejects.toBeInstanceOf(SchemaChangedError);
  });
});
