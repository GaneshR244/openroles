import type { TestingModule } from '@nestjs/testing';
import { BoardLaneService, nextFetchAt } from '../src/ingestion/board-lane.service.js';
import { JobStoreService } from '../src/ingestion/job-store.service.js';
import { BoardReaders } from '../src/ingestion/sources/board-readers.js';
import type { RawJob } from '../src/ingestion/sources/source.types.js';
import {
  NetworkError,
  NotFoundError,
  RateLimitedError,
  ServerError,
  TimeoutError,
} from '../src/common/http/errors.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { createTestingApp, resetDb } from './helpers/db.js';

/** A fake reader whose response we script per test. */
class ScriptedReaders {
  response: RawJob[] | Error = [];
  truncated = false;
  calls = 0;
  get() {
    return {
      ats: 'GREENHOUSE' as const,
      read: async () => {
        this.calls++;
        if (this.response instanceof Error) throw this.response;
        return { jobs: this.response, truncated: this.truncated };
      },
    };
  }
}

const raw = (id: string, overrides: Partial<RawJob> = {}): RawJob => ({
  source: 'GREENHOUSE',
  externalId: id,
  title: `Engineer ${id}`,
  companyName: 'Acme Payments',
  locations: ['Bengaluru, India'],
  countryCodes: [],
  url: `https://boards.greenhouse.io/acme/jobs/${id}`,
  postedAt: new Date('2026-11-20T10:00:00Z'),
  ...overrides,
});

describe('BoardLaneService (integration, real PostgreSQL)', () => {
  let moduleRef: TestingModule;
  let lane: BoardLaneService;
  let prisma: PrismaService;
  const readers = new ScriptedReaders();
  const day1 = new Date('2026-11-25T00:40:00Z'); // 06:10 IST
  const farDeadline = new Date('2100-01-01T00:00:00Z');

  beforeAll(async () => {
    moduleRef = await createTestingApp([
      BoardLaneService,
      JobStoreService,
      { provide: BoardReaders, useValue: readers },
    ]);
    lane = moduleRef.get(BoardLaneService);
    prisma = moduleRef.get(PrismaService);
  });

  beforeEach(async () => {
    await resetDb(prisma);
    readers.response = [];
    readers.truncated = false;
    readers.calls = 0;
  });

  afterAll(async () => {
    await moduleRef.close();
  });

  async function makeBoard(nextAt = new Date('2026-11-24T18:30:00Z')) {
    const company = await prisma.company.create({
      data: { name: 'Acme Payments', normalizedName: 'acme payments', discoveredVia: 'board' },
    });
    return prisma.board.create({
      data: { ats: 'GREENHOUSE', slug: 'acme', companyId: company.id, nextFetchAt: nextAt },
    });
  }

  const runAt = (now: Date) => lane.run({ now, deadline: farDeadline });
  const board = (id: string) => prisma.board.findUniqueOrThrow({ where: { id } });

  it('first read inserts jobs and schedules the board for the next IST morning', async () => {
    const b = await makeBoard();
    readers.response = [raw('1'), raw('2'), raw('3')];
    const stats = await runAt(day1);
    expect(stats).toMatchObject({ due: 1, read: 1, new: 3, closed: 0, failed: 0 });
    const after = await board(b.id);
    expect(after.openJobs).toBe(3);
    expect(after.fetchIntervalDays).toBe(1);
    expect(after.nextFetchAt.toISOString()).toBe('2026-11-25T18:30:00.000Z'); // 26 Nov 00:00 IST
    expect(after.lastJobsHash).toMatch(/^[0-9a-f]{40}$/);
  });

  it('unchanged boards are touched in one query and checked less often (1 → 2 → 4 → 7 days)', async () => {
    const b = await makeBoard();
    readers.response = [raw('1'), raw('2')];
    await runAt(day1);

    let now = new Date(day1);
    for (const expected of [2, 4, 7, 7]) {
      const current = await board(b.id);
      now = new Date(current.nextFetchAt.getTime() + 40 * 60_000);
      const stats = await runAt(now);
      expect(stats.unchanged).toBe(1);
      const after = await board(b.id);
      expect(after.fetchIntervalDays).toBe(expected);
      expect(after.nextFetchAt).toEqual(nextFetchAt(now, expected));
    }
    const jobs = await prisma.job.findMany();
    expect(jobs.every((j) => j.lastSeenAt.getTime() === now.getTime())).toBe(true);
  });

  it('a changed board closes removed jobs and goes back to daily checks', async () => {
    const b = await makeBoard();
    readers.response = [raw('A'), raw('B'), raw('C'), raw('D')];
    await runAt(day1);
    readers.response = [raw('B'), raw('C'), raw('D'), raw('E'), raw('F')];
    const day2 = new Date('2026-11-26T00:40:00Z');
    const stats = await runAt(day2);
    expect(stats).toMatchObject({ new: 2, closed: 1 });
    const a = await prisma.job.findFirstOrThrow({ where: { externalId: 'A' } });
    expect(a.status).toBe('CLOSED');
    expect((await board(b.id)).openJobs).toBe(5);
  });

  it('failures keep jobs open; the third marks the board BROKEN, closes its jobs and retries weekly', async () => {
    const b = await makeBoard();
    readers.response = [raw('1')];
    await runAt(day1);
    readers.response = new NotFoundError('https://boards-api.greenhouse.io/v1/boards/acme/jobs');
    let now = day1;
    for (let i = 0; i < 2; i++) {
      now = new Date((await board(b.id)).nextFetchAt.getTime() + 60_000);
      await runAt(now);
    }
    expect(await prisma.job.count({ where: { status: 'ACTIVE' } })).toBe(1); // 2 failures: still open

    now = new Date((await board(b.id)).nextFetchAt.getTime() + 60_000);
    const third = await runAt(now);
    expect(third).toMatchObject({ broken: 1, closed: 1 });
    const after = await board(b.id);
    expect(after.failCount).toBe(3);
    expect(after.status).toBe('BROKEN');
    expect(after.nextFetchAt).toEqual(nextFetchAt(now, 7));
    expect(await prisma.job.count({ where: { status: 'ACTIVE' } })).toBe(0);

    readers.calls = 0;
    await runAt(new Date(now.getTime() + 86_400_000)); // next day: skipped
    expect(readers.calls).toBe(0);

    readers.response = [raw('1')]; // a week later the board works again
    await runAt(new Date(after.nextFetchAt.getTime() + 60_000));
    expect(readers.calls).toBe(1);
    const healed = await board(b.id);
    expect(healed.status).toBe('ACTIVE');
    expect(healed.failCount).toBe(0);
    expect(await prisma.job.count({ where: { status: 'ACTIVE' } })).toBe(1); // reopened
  });

  it('timeouts, network errors and 5xx are not counted against the board', async () => {
    const b = await makeBoard();
    for (const err of [
      new TimeoutError('https://x', 10_000),
      new NetworkError('https://x'),
      new ServerError('https://x', 503),
    ]) {
      readers.response = err;
      const now = new Date((await board(b.id)).nextFetchAt.getTime() + 60_000);
      const stats = await runAt(now);
      expect(stats).toMatchObject({ transient: 1, failed: 0 });
    }
    expect((await board(b.id)).failCount).toBe(0);
  });

  it('a repost with a new ID keeps the role open and points it at the live posting', async () => {
    const b = await makeBoard();
    readers.response = [raw('111', { title: 'Account Executive', locations: ['Mumbai, India'] })];
    await runAt(day1);
    readers.response = [raw('222', { title: 'Account Executive', locations: ['Mumbai, India'] })];
    const stats = await runAt(new Date('2026-11-26T00:40:00Z'));
    expect(stats).toMatchObject({ new: 0, closed: 0 });
    const rows = await prisma.job.findMany();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ externalId: '222', status: 'ACTIVE' });
    expect(rows[0]!.url).toContain('/222');
    expect((await board(b.id)).openJobs).toBe(1);
  });

  it('two openings with the same title: when one closes, the role stays open', async () => {
    await makeBoard();
    const same = { title: 'Sales Executive', locations: ['Chennai, India'] };
    readers.response = [raw('a1', same), raw('a2', same), raw('b1')];
    await runAt(day1);
    readers.response = [raw('a2', same), raw('b1')];
    const stats = await runAt(new Date('2026-11-26T00:40:00Z'));
    expect(stats.closed).toBe(0);
    expect(await prisma.job.count({ where: { status: 'ACTIVE' } })).toBe(2);
  });

  it('empty-response guard: one empty read closes nothing, a second closes everything', async () => {
    const b = await makeBoard();
    readers.response = [raw('1'), raw('2')];
    await runAt(day1);
    readers.response = [];
    const day2 = new Date('2026-11-26T00:40:00Z');
    const s1 = await runAt(day2);
    expect(s1.suspiciousEmpty).toBe(1);
    expect(await prisma.job.count({ where: { status: 'ACTIVE' } })).toBe(2);
    expect((await board(b.id)).emptyCount).toBe(1);

    const day3 = new Date('2026-11-27T00:40:00Z');
    const s2 = await runAt(day3);
    expect(s2.closed).toBe(2);
    expect(await prisma.job.count({ where: { status: 'ACTIVE' } })).toBe(0);
  });

  it('skips boards that are not due, and stops at the deadline', async () => {
    await makeBoard(new Date('2026-12-01T00:00:00Z'));
    const notDue = await runAt(day1);
    expect(notDue.due).toBe(0);

    await resetDb(prisma);
    await makeBoard();
    readers.response = [raw('1')];
    const late = await lane.run({ now: day1, deadline: new Date('2000-01-01T00:00:00Z') });
    expect(late.due).toBe(1);
    expect(late.read).toBe(0);
    expect(late.stoppedByDeadline).toBe(true);
  });
  it('a truncated read saves new jobs but never closes any', async () => {
    const b = await makeBoard();
    readers.response = [raw('A'), raw('B'), raw('C')];
    await runAt(day1);
    readers.response = [raw('A'), raw('D')]; // pretend the page cap cut the list short
    readers.truncated = true;
    const stats = await runAt(new Date('2026-11-26T00:40:00Z'));
    expect(stats).toMatchObject({ truncated: 1, new: 1, closed: 0 });
    expect(await prisma.job.count({ where: { status: 'ACTIVE' } })).toBe(4);
    expect((await board(b.id)).lastJobsHash).toBeNull();
  });

  it('a host-level block (rate limit) is retried tomorrow without counting a failure', async () => {
    const b = await makeBoard();
    readers.response = new RateLimitedError('https://apply.workable.com/x', 86_000_000);
    const stats = await runAt(day1);
    expect(stats).toMatchObject({ transient: 1, failed: 0 });
    const after = await board(b.id);
    expect(after.failCount).toBe(0);
    expect(after.status).toBe('ACTIVE');
  });
});
