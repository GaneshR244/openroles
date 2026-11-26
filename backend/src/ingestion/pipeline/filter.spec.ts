import type { RawJob } from '../sources/source.types.js';
import { prepareBatch } from './filter.js';
import { fingerprint } from './normalize.js';
import type { BatchContext, DropReason } from './pipeline.types.js';

const NOW = new Date('2026-11-25T06:00:00Z');

function raw(overrides: Partial<RawJob> = {}): RawJob {
  return {
    source: 'GREENHOUSE',
    externalId: '1',
    title: 'Software Engineer',
    companyName: 'Acme Pvt Ltd',
    locations: ['Pune, India'],
    countryCodes: [],
    url: 'https://boards.example.com/acme/jobs/1',
    postedAt: new Date('2026-11-20T00:00:00Z'),
    ...overrides,
  };
}

function boardCtx(overrides: Partial<BatchContext> = {}): BatchContext {
  return {
    now: NOW,
    maxAgeDays: 30,
    targetCountries: ['IN', 'AE', 'US'],
    isBoard: true,
    blocklist: new Set(),
    ...overrides,
  };
}

function linkedinCtx(overrides: Partial<BatchContext> = {}): BatchContext {
  return boardCtx({ isBoard: false, searchCountry: 'IN', ...overrides });
}

function drops(counts: Partial<Record<DropReason, number>> = {}): Record<DropReason, number> {
  return {
    missing_fields: 0,
    too_old: 0,
    outside_markets: 0,
    remote_without_market: 0,
    blocklisted: 0,
    duplicate_in_batch: 0,
    ...counts,
  };
}

describe('prepareBatch', () => {
  it('builds a full normalized job', () => {
    const result = prepareBatch(
      [
        raw({
          externalId: ' 42 ',
          title: ' Sr. Software Eng ',
          companyLinkedinUrl: 'https://www.linkedin.com/company/acme',
          locations: [' Pune, India ', 'Remote'],
          workModeHint: 'hybrid',
        }),
      ],
      boardCtx(),
    );

    expect(result.kept).toEqual([
      {
        source: 'GREENHOUSE',
        externalId: '42',
        title: 'Sr. Software Eng',
        companyName: 'Acme Pvt Ltd',
        normalizedCompany: 'acme',
        companyLinkedinUrl: 'https://www.linkedin.com/company/acme',
        location: 'Pune, India',
        country: 'IN',
        workMode: 'HYBRID',
        url: 'https://boards.example.com/acme/jobs/1',
        postedAt: new Date('2026-11-20T00:00:00Z'),
        fingerprint: fingerprint('Acme', 'Senior Software Engineer', 'Pune India'),
      },
    ]);
    expect(result.seen).toEqual([{ externalId: '42', fingerprint: result.kept[0].fingerprint }]);
    expect(result.dropped).toEqual(drops());
  });

  it('reports every drop reason, zeros included', () => {
    expect(prepareBatch([], boardCtx())).toEqual({ seen: [], kept: [], dropped: drops() });
  });

  it.each<[string, Partial<RawJob>]>([
    ['externalId', { externalId: '' }],
    ['title', { title: '   ' }],
    ['companyName', { companyName: undefined }],
    ['url', { url: '' }],
  ])('drops a job without %s and leaves it out of seen', (_field, overrides) => {
    const result = prepareBatch([raw(overrides)], boardCtx());
    expect(result.kept).toEqual([]);
    expect(result.seen).toEqual([]);
    expect(result.dropped).toEqual(drops({ missing_fields: 1 }));
  });

  it("uses the board's company name over the source's", () => {
    const result = prepareBatch(
      [raw({ companyName: undefined }), raw({ externalId: '2', companyName: 'acme-inc' })],
      boardCtx({ companyName: 'Acme Payments' }),
    );
    expect(result.kept.map((j) => j.companyName)).toEqual(['Acme Payments']);
    expect(result.dropped).toEqual(drops({ duplicate_in_batch: 1 }));
  });

  it('drops an old job but still lists it in seen', () => {
    const old = raw({ externalId: 'old', postedAt: new Date('2026-10-01T00:00:00Z') });
    const result = prepareBatch([old], boardCtx());
    expect(result.kept).toEqual([]);
    expect(result.seen).toEqual([
      { externalId: 'old', fingerprint: fingerprint('Acme', 'Software Engineer', 'Pune, India') },
    ]);
    expect(result.dropped).toEqual(drops({ too_old: 1 }));
  });

  it('keeps a job exactly at the age limit', () => {
    const edge = raw({ postedAt: new Date('2026-10-26T06:00:00Z') });
    expect(prepareBatch([edge], boardCtx()).kept).toHaveLength(1);
  });

  it('uses now when the posted date is missing or invalid', () => {
    const result = prepareBatch(
      [
        raw({ postedAt: undefined }),
        raw({ externalId: '2', title: 'Designer', postedAt: new Date('nope') }),
      ],
      boardCtx(),
    );
    expect(result.kept.map((j) => j.postedAt)).toEqual([NOW, NOW]);
  });

  it('drops a board job outside our markets', () => {
    const result = prepareBatch([raw({ locations: ['Paris, France'] })], boardCtx());
    expect(result.kept).toEqual([]);
    expect(result.seen).toHaveLength(1);
    expect(result.dropped).toEqual(drops({ outside_markets: 1 }));
  });

  it('keeps a plain remote job when the same board hires in a target country', () => {
    const result = prepareBatch(
      [
        raw({ externalId: '1', locations: ['Pune'] }),
        raw({ externalId: '2', title: 'Support Engineer', locations: ['Remote'] }),
      ],
      boardCtx(),
    );
    expect(result.kept.map((j) => [j.externalId, j.country, j.location, j.workMode])).toEqual([
      ['1', 'IN', 'Pune', 'UNKNOWN'],
      ['2', null, 'Remote', 'REMOTE'],
    ]);
    expect(result.dropped).toEqual(drops());
  });

  it('keeps a plain remote board job when the target job is too old', () => {
    const result = prepareBatch(
      [
        raw({ externalId: '1', postedAt: new Date('2026-01-01T00:00:00Z') }),
        raw({ externalId: '2', title: 'Support Engineer', locations: ['Remote'] }),
      ],
      boardCtx(),
    );
    expect(result.kept.map((j) => j.externalId)).toEqual(['2']);
    expect(result.dropped).toEqual(drops({ too_old: 1 }));
  });

  it('drops plain remote jobs on a board with no target-country job', () => {
    const result = prepareBatch(
      [
        raw({ externalId: '1', locations: ['Remote'] }),
        raw({ externalId: '2', title: 'Designer', locations: ['Paris'] }),
        raw({ externalId: '3', title: 'Analyst', locations: [] }),
      ],
      boardCtx(),
    );
    expect(result.kept).toEqual([]);
    expect(result.dropped).toEqual(drops({ remote_without_market: 2, outside_markets: 1 }));
  });

  it('keeps a plain remote job only on boards', () => {
    const result = prepareBatch(
      [raw({ externalId: '1' }), raw({ externalId: '2', title: 'QA', locations: ['Remote'] })],
      boardCtx({ isBoard: false }),
    );
    expect(result.kept.map((j) => j.externalId)).toEqual(['1']);
    expect(result.dropped).toEqual(drops({ remote_without_market: 1 }));
  });

  it("falls back to the LinkedIn search's country", () => {
    const result = prepareBatch(
      [
        raw({ source: 'LINKEDIN', externalId: '1', locations: ['Remote'] }),
        raw({ source: 'LINKEDIN', externalId: '2', title: 'QA', locations: ['Somewhere'] }),
        raw({ source: 'LINKEDIN', externalId: '3', title: 'PM', locations: ['Dubai, UAE'] }),
      ],
      linkedinCtx(),
    );
    expect(result.kept.map((j) => [j.externalId, j.country])).toEqual([
      ['1', 'IN'],
      ['2', 'IN'],
      ['3', 'AE'],
    ]);
    expect(result.dropped).toEqual(drops());
  });

  it('drops blocklisted companies by normalized name', () => {
    const result = prepareBatch(
      [
        raw({ companyName: 'Spammy Jobs Pvt. Ltd.' }),
        raw({ externalId: '2', companyName: 'Acme' }),
      ],
      linkedinCtx({ blocklist: new Set(['spammy jobs']) }),
    );
    expect(result.kept.map((j) => j.companyName)).toEqual(['Acme']);
    expect(result.seen).toHaveLength(2);
    expect(result.dropped).toEqual(drops({ blocklisted: 1 }));
  });

  it('keeps the first of two jobs with the same fingerprint', () => {
    const result = prepareBatch(
      [
        raw({ externalId: 'a', title: 'Sr. Software Eng' }),
        raw({ externalId: 'b', title: 'Senior Software Engineer' }),
        raw({ externalId: 'c', title: 'Designer' }),
      ],
      boardCtx(),
    );
    expect(result.kept.map((j) => j.externalId)).toEqual(['a', 'c']);
    expect(result.seen.map((s) => s.externalId)).toEqual(['a', 'b', 'c']);
    expect(result.dropped).toEqual(drops({ duplicate_in_batch: 1 }));
  });

  it('sets location to null when there is none', () => {
    const result = prepareBatch(
      [raw({ locations: [], countryCodes: ['IN'] }), raw({ externalId: '2', locations: ['  '] })],
      linkedinCtx(),
    );
    expect(result.kept.map((j) => j.location)).toEqual([null]);
    expect(result.dropped).toEqual(drops({ duplicate_in_batch: 1 }));
  });
});

describe('prepareBatch: every country (TARGET_COUNTRIES=ALL)', () => {
  const worldwide = (overrides: Partial<BatchContext> = {}) =>
    boardCtx({ targetCountries: [], ...overrides });

  it('keeps jobs anywhere, with their country', () => {
    const { kept, dropped } = prepareBatch(
      [
        raw({ externalId: '1', title: 'A', locations: ['Berlin, Germany'] }),
        raw({ externalId: '2', title: 'B', locations: ['Remote - EMEA'] }),
        raw({ externalId: '3', title: 'C', locations: ['Remote'] }),
        raw({ externalId: '4', title: 'D', locations: ['Toronto, ON'], countryCodes: ['CA'] }),
      ],
      worldwide(),
    );
    expect(kept.map((j) => [j.externalId, j.country])).toEqual([
      ['1', 'DE'],
      ['2', null],
      ['3', null],
      ['4', 'CA'],
    ]);
    expect(dropped).toEqual(drops());
  });

  it('still drops old jobs', () => {
    const { kept, dropped } = prepareBatch(
      [raw({ postedAt: new Date('2026-09-01T00:00:00Z'), locations: ['Paris'] })],
      worldwide(),
    );
    expect(kept).toEqual([]);
    expect(dropped).toEqual(drops({ too_old: 1 }));
  });

  it('gives an unclear LinkedIn job its search country', () => {
    const { kept } = prepareBatch(
      [raw({ source: 'LINKEDIN', locations: ['Remote'] })],
      worldwide({ isBoard: false, searchCountry: 'AE' }),
    );
    expect(kept[0]!.country).toBe('AE');
  });
});
