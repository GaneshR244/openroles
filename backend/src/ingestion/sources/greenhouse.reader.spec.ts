import { readFileSync } from 'node:fs';
import { NotFoundError, SchemaChangedError } from '../../common/http/errors.js';
import type { HttpClient } from '../../common/http/http-client.js';
import { GreenhouseReader } from './greenhouse.reader.js';

// Real response from boards-api.greenhouse.io/v1/boards/stripe/jobs (25 Nov 2026), trimmed to 15.
const fixture = () =>
  JSON.parse(
    readFileSync(new URL('../../../test/fixtures/greenhouse.json', import.meta.url), 'utf8'),
  );

function setup() {
  const http = { getJson: vi.fn(), postJson: vi.fn(), getText: vi.fn() };
  return { http, reader: new GreenhouseReader(http as unknown as HttpClient) };
}

describe('GreenhouseReader', () => {
  it('reads every job from the fixture', async () => {
    const { http, reader } = setup();
    http.getJson.mockResolvedValueOnce(fixture());

    const { jobs, truncated } = await reader.read('stripe');

    expect(truncated).toBe(false);

    expect(http.getJson).toHaveBeenCalledTimes(1);
    expect(http.getJson.mock.calls[0][0]).toBe(
      'https://boards-api.greenhouse.io/v1/boards/stripe/jobs',
    );
    expect(jobs).toHaveLength(15);
    expect(jobs[0]).toEqual({
      source: 'GREENHOUSE',
      externalId: '8172510',
      title: 'Abuse Investigator',
      companyName: 'Stripe',
      locations: ['Seattle, San Francisco, New York City'],
      countryCodes: [],
      url: 'https://stripe.com/jobs/search?gh_jid=8172510',
      postedAt: new Date('2026-09-09T10:50:29-04:00'),
    });
  });

  it('uses updated_at when first_published is missing', async () => {
    const { http, reader } = setup();
    const data = fixture();
    data.jobs[0].first_published = null;
    http.getJson.mockResolvedValueOnce(data);

    const {
      jobs: [job],
    } = await reader.read('stripe');
    expect(job.postedAt).toEqual(new Date('2026-11-19T12:12:24-05:00'));
  });

  it('passes timeout and attempts to the HTTP client', async () => {
    const { http, reader } = setup();
    http.getJson.mockResolvedValueOnce({ jobs: [] });

    await reader.read('stripe', { timeoutMs: 3_000, maxAttempts: 1, maxPages: 1 });
    expect(http.getJson.mock.calls[0][1]).toEqual({ timeoutMs: 3_000, maxAttempts: 1 });
  });

  it('lets NotFoundError through for an unknown slug', async () => {
    const { http, reader } = setup();
    http.getJson.mockRejectedValueOnce(new NotFoundError('https://boards-api.greenhouse.io/x'));

    await expect(reader.read('nope')).rejects.toBeInstanceOf(NotFoundError);
  });

  it('throws SchemaChangedError on a broken payload', async () => {
    const { http, reader } = setup();
    http.getJson.mockResolvedValueOnce({ jobs: [{ id: '8172510', title: 'Engineer' }] });

    const error = await reader.read('stripe').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(SchemaChangedError);
    expect((error as SchemaChangedError).reason).toMatch(/^jobs\.0\.id/);
  });
});
