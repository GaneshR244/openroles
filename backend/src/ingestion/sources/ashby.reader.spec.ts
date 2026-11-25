import { readFileSync } from 'node:fs';
import { SchemaChangedError } from '../../common/http/errors.js';
import type { HttpClient } from '../../common/http/http-client.js';
import { AshbyReader } from './ashby.reader.js';

// Real response from api.ashbyhq.com/posting-api/job-board/ramp (25 Nov 2026), trimmed to 15.
const fixture = () =>
  JSON.parse(readFileSync(new URL('../../../test/fixtures/ashby.json', import.meta.url), 'utf8'));

function setup() {
  const http = { getJson: vi.fn(), postJson: vi.fn(), getText: vi.fn() };
  return { http, reader: new AshbyReader(http as unknown as HttpClient) };
}

describe('AshbyReader', () => {
  it('reads every listed job from the fixture', async () => {
    const { http, reader } = setup();
    http.getJson.mockResolvedValueOnce(fixture());

    const { jobs, truncated } = await reader.read('ramp');

    expect(truncated).toBe(false);

    expect(http.getJson.mock.calls[0][0]).toBe(
      'https://api.ashbyhq.com/posting-api/job-board/ramp',
    );
    expect(jobs).toHaveLength(15);
    expect(jobs[0]).toEqual({
      source: 'ASHBY',
      externalId: '34413f8d-26bf-4bbc-8ade-eb309a0e2245',
      title: ' Software Engineer, Security, Cloud', // as given; the pipeline trims
      locations: ['New York, NY (HQ)', 'Remote (Canada)', 'Remote (US)', 'Miami, FL'],
      countryCodes: ['USA'],
      workModeHint: 'Hybrid',
      url: 'https://jobs.ashbyhq.com/ramp/34413f8d-26bf-4bbc-8ade-eb309a0e2245',
      postedAt: new Date('2026-04-07T17:12:35.753+00:00'),
    });
  });

  it('skips unlisted jobs', async () => {
    const { http, reader } = setup();
    const data = fixture();
    const hidden = data.jobs[1].id;
    data.jobs[1].isListed = false;
    http.getJson.mockResolvedValueOnce(data);

    const { jobs } = await reader.read('ramp');
    expect(jobs).toHaveLength(14);
    expect(jobs.map((j) => j.externalId)).not.toContain(hidden);
  });

  it('uses isRemote when there is no workplaceType', async () => {
    const { http, reader } = setup();
    const data = fixture();
    delete data.jobs[0].workplaceType;
    delete data.jobs[0].address;
    data.jobs[0].secondaryLocations = [];
    http.getJson.mockResolvedValueOnce(data);

    const {
      jobs: [job],
    } = await reader.read('ramp');
    expect(job.workModeHint).toBe('remote');
    expect(job.countryCodes).toEqual([]);
    expect(job.locations).toEqual(['New York, NY (HQ)']);
  });

  it('throws SchemaChangedError when isListed disappears', async () => {
    const { http, reader } = setup();
    const data = fixture();
    delete data.jobs[0].isListed;
    http.getJson.mockResolvedValueOnce(data);

    const error = await reader.read('ramp').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(SchemaChangedError);
    expect((error as SchemaChangedError).reason).toMatch(/^jobs\.0\.isListed/);
  });
});
