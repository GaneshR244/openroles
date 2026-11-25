import { decideStatus } from './run-stats.js';
import { windowSeconds } from './run-orchestrator.service.js';
import { isAnomaly } from './reporter.service.js';
import { jobsHash, nextFetchAt, nextInterval } from './board-lane.service.js';
import { slugCandidates, verifyHit } from './board-finder.service.js';
import type { RawJob } from './sources/source.types.js';
import type { BoardLaneStats } from './board-lane.service.js';

const boards = (over: Partial<BoardLaneStats> = {}): BoardLaneStats => ({
  due: 100,
  read: 100,
  unchanged: 50,
  failed: 0,
  hostBlocked: 0,
  broken: 0,
  truncated: 0,
  suspiciousEmpty: 0,
  new: 10,
  closed: 2,
  stoppedByDeadline: false,
  dropped: {
    missing_fields: 0,
    too_old: 0,
    outside_markets: 0,
    remote_without_market: 0,
    blocklisted: 0,
    duplicate_in_batch: 0,
  },
  errors: [],
  ...over,
});
const base = (b: BoardLaneStats) => ({
  window: { since: '', seconds: 0 },
  linkedin: { enabled: false, requests: 0, cards: 0, new: 0, saturated: [], blocked: false },
  boards: b,
  boardsSecondPass: null,
  finder: null,
  retention: { deletedJobs: 0, deletedRuns: 0 },
  totals: { newJobs: 0, newCompanies: 0 },
});

describe('decideStatus', () => {
  it('SUCCESS when a few boards fail (normal noise)', () => {
    expect(decideStatus(base(boards({ failed: 5, read: 95 }))).status).toBe('SUCCESS');
  });
  it('PARTIAL when more than 10% of boards fail, or the deadline hits', () => {
    expect(decideStatus(base(boards({ failed: 11, read: 89 })))).toEqual({
      status: 'PARTIAL',
      reasons: ['many_board_failures'],
    });
    expect(decideStatus(base(boards({ stoppedByDeadline: true }))).reasons).toContain('deadline');
  });
  it('FAILED when nothing could be read', () => {
    expect(decideStatus(base(boards({ read: 0, failed: 100 }))).status).toBe('FAILED');
  });
  it('SUCCESS on an empty first day with no boards yet', () => {
    expect(decideStatus(base(boards({ due: 0, read: 0 }))).status).toBe('SUCCESS');
  });
});

describe('windowSeconds', () => {
  const now = new Date('2026-11-26T00:30:00Z');
  it('defaults to 24 h on the first run', () => {
    expect(windowSeconds(now, null, 30)).toBe(86_400);
  });
  it('covers a missed day: 48 h since the last good run, plus 1 h overlap', () => {
    expect(windowSeconds(now, new Date('2026-11-24T00:30:00Z'), 30)).toBe(49 * 3600);
  });
  it('never exceeds the max job age', () => {
    expect(windowSeconds(now, new Date('2026-01-01T00:00:00Z'), 30)).toBe(30 * 86_400);
  });
});

describe('isAnomaly (7-run moving average)', () => {
  it('flags a sudden drop', () => {
    expect(isAnomaly(10, [300, 280, 310, 290])).toBe(true);
  });
  it('ignores normal days, small averages and short history', () => {
    expect(isAnomaly(250, [300, 280, 310])).toBe(false);
    expect(isAnomaly(0, [5, 8, 6])).toBe(false);
    expect(isAnomaly(0, [300, 300])).toBe(false);
  });
});

describe('board polling helpers', () => {
  it('jobsHash ignores order and changes when the set changes', () => {
    expect(jobsHash(['b', 'a'])).toBe(jobsHash(['a', 'b']));
    expect(jobsHash(['a', 'b'])).not.toBe(jobsHash(['a', 'b', 'c']));
  });
  it('nextInterval: daily on change, doubling to 7 days when quiet', () => {
    expect([1, 2, 4, 7].map((d) => nextInterval(d, false))).toEqual([2, 4, 7, 7]);
    expect(nextInterval(7, true)).toBe(1);
  });
  it('nextFetchAt lands on IST midnight', () => {
    expect(nextFetchAt(new Date('2026-11-25T00:40:00Z'), 2).toISOString()).toBe(
      '2026-11-26T18:30:00.000Z',
    );
  });
});

describe('board finder helpers', () => {
  it('guesses board names, with original casing only for SmartRecruiters', () => {
    const c = { normalizedName: 'acme payments', website: 'https://www.acmepay.io' };
    expect(slugCandidates(c, 'GREENHOUSE')).toEqual(['acmepayments', 'acme-payments', 'acmepay']);
    expect(slugCandidates(c, 'SMARTRECRUITERS')).toEqual([
      'acmepayments',
      'AcmePayments',
      'acme-payments',
      'acmepay',
    ]);
    expect(
      slugCandidates({ normalizedName: 'freshworks', website: null }, 'SMARTRECRUITERS'),
    ).toEqual(['freshworks', 'Freshworks']);
  });

  const rawJob = (over: Partial<RawJob>): RawJob => ({
    source: 'LEVER',
    externalId: '1',
    title: 'Engineer',
    locations: ['Bengaluru, India'],
    countryCodes: [],
    url: 'https://x',
    ...over,
  });

  it('accepts a hit when the slug matches the cleaned name and a job is in our markets', () => {
    expect(verifyHit([rawJob({})], { normalizedName: 'cred' }, 'cred', ['IN', 'AE', 'US'])).toBe(
      true,
    );
  });
  it('rejects empty boards, name mismatches and boards outside our markets', () => {
    expect(verifyHit([], { normalizedName: 'cred' }, 'cred', ['IN'])).toBe(false);
    expect(verifyHit([rawJob({})], { normalizedName: 'cred' }, 'credit', ['IN'])).toBe(false);
    expect(
      verifyHit([rawJob({ locations: ['Paris'] })], { normalizedName: 'cred' }, 'cred', ['IN']),
    ).toBe(false);
  });
  it('uses the API company name when the source gives one', () => {
    const job = rawJob({
      companyName: 'Freshworks Inc.',
      countryCodes: ['in'],
      locations: ['Chennai'],
    });
    expect(verifyHit([job], { normalizedName: 'freshworks' }, 'Freshworks', ['IN'])).toBe(true);
    expect(
      verifyHit([rawJob({ companyName: 'Other Co' })], { normalizedName: 'acme' }, 'acme-hq', [
        'IN',
      ]),
    ).toBe(false);
  });
});
