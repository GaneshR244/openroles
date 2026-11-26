import type { TestingModule } from '@nestjs/testing';
import { BoardLaneService } from '../src/ingestion/board-lane.service.js';
import { BoardFinderService } from '../src/ingestion/board-finder.service.js';
import { BoardImportService, emptyImportStats } from '../src/ingestion/board-import.service.js';
import {
  LinkedInLaneService,
  disabledLinkedInStats,
} from '../src/ingestion/linkedin-lane.service.js';
import { JobStoreService } from '../src/ingestion/job-store.service.js';
import { RetentionService } from '../src/ingestion/retention.service.js';
import { ReporterService } from '../src/ingestion/reporter.service.js';
import { RunOrchestratorService } from '../src/ingestion/run-orchestrator.service.js';
import { BoardReaders } from '../src/ingestion/sources/board-readers.js';
import type { RawJob } from '../src/ingestion/sources/source.types.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { createTestingApp, resetDb } from './helpers/db.js';

const raw = (id: string): RawJob => ({
  source: 'LEVER',
  externalId: id,
  title: `Role ${id}`,
  locations: ['Pune, India'],
  countryCodes: ['IN'],
  url: `https://jobs.lever.co/acme/${id}`,
  postedAt: new Date(),
});

const readers = {
  get: () => ({
    ats: 'LEVER' as const,
    read: async () => ({ jobs: [raw('1'), raw('2'), raw('3')], truncated: false }),
  }),
};
const boardImport = {
  isDue: vi.fn(async () => false),
  run: vi.fn(async () => ({ ...emptyImportStats(), crawls: ['CC-TEST'], complete: true })),
};
const finder = {
  run: async () => ({
    probedCompanies: 0,
    boardsFound: 0,
    probeErrors: 0,
    stoppedByDeadline: false,
  }),
};

describe('RunOrchestratorService (integration, real PostgreSQL)', () => {
  let moduleRef: TestingModule;
  let orchestrator: RunOrchestratorService;
  let prisma: PrismaService;

  beforeAll(async () => {
    moduleRef = await createTestingApp([
      RunOrchestratorService,
      BoardLaneService,
      JobStoreService,
      RetentionService,
      ReporterService,
      { provide: BoardReaders, useValue: readers },
      { provide: BoardFinderService, useValue: finder },
      { provide: BoardImportService, useValue: boardImport },
      { provide: LinkedInLaneService, useValue: { run: async () => disabledLinkedInStats() } },
    ]);
    orchestrator = moduleRef.get(RunOrchestratorService);
    prisma = moduleRef.get(PrismaService);
  });

  beforeEach(async () => {
    await resetDb(prisma);
    const company = await prisma.company.create({
      data: { name: 'Acme', normalizedName: 'acme', discoveredVia: 'board' },
    });
    await prisma.board.create({
      data: { ats: 'LEVER', slug: 'acme', companyId: company.id, nextFetchAt: new Date(0) },
    });
  });

  afterAll(async () => {
    await moduleRef.close();
  });

  it('the lease allows only one RUNNING run', async () => {
    const now = new Date();
    const first = await orchestrator.acquireLease(now, 'manual');
    expect(first).not.toBeNull();
    expect(await orchestrator.acquireLease(now, 'manual')).toBeNull();
  });

  it('a stale lease (no heartbeat for 10+ minutes) is marked FAILED and taken over', async () => {
    const old = new Date(Date.now() - 30 * 60_000);
    const stale = await orchestrator.acquireLease(old, 'cron');
    const fresh = await orchestrator.acquireLease(new Date(), 'manual');
    expect(fresh).not.toBeNull();
    const staleRow = await prisma.fetchRun.findUniqueOrThrow({ where: { id: stale!.id } });
    expect(staleRow.status).toBe('FAILED');
    expect(staleRow.error).toMatch(/stale lease/);
  });

  it('a full run writes a report, and a second run adds 0 jobs', async () => {
    const r1 = await orchestrator.run({ trigger: 'manual' });
    expect(r1.status).toBe('SUCCESS');
    if (r1.status === 'SKIPPED') throw new Error('unexpected skip');
    expect(r1.stats.totals.newJobs).toBe(3);
    const row = await prisma.fetchRun.findUniqueOrThrow({ where: { id: r1.runId } });
    expect(row.finishedAt).not.toBeNull();
    expect((row.stats as any).boards.new).toBe(3);

    // make the board due again and run once more
    await prisma.board.updateMany({ data: { nextFetchAt: new Date(0) } });
    const r2 = await orchestrator.run({ trigger: 'manual' });
    if (r2.status === 'SKIPPED') throw new Error('unexpected skip');
    expect(r2.stats.totals.newJobs).toBe(0);
    expect(r2.stats.boards.unchanged).toBe(1);
    expect(await prisma.job.count()).toBe(3);
  });

  it('runs the board import only when due or forced, and records it', async () => {
    boardImport.run.mockClear();
    const skipped = await orchestrator.run({ trigger: 'manual' });
    if (skipped.status === 'SKIPPED') throw new Error('unexpected skip');
    expect(boardImport.run).not.toHaveBeenCalled();
    expect(skipped.stats.boardImport).toBeNull();

    const forced = await orchestrator.run({ trigger: 'manual', importBoards: 'force' });
    if (forced.status === 'SKIPPED') throw new Error('unexpected skip');
    expect(boardImport.run).toHaveBeenCalledOnce();
    const row = await prisma.fetchRun.findUniqueOrThrow({ where: { id: forced.runId } });
    expect((row.stats as any).boardImport).toMatchObject({ crawls: ['CC-TEST'], complete: true });
  });

  it('a failing board import never stops the run', async () => {
    boardImport.run.mockRejectedValueOnce(new Error('Common Crawl is down'));
    const r = await orchestrator.run({ trigger: 'manual', importBoards: 'force' });
    if (r.status === 'SKIPPED') throw new Error('unexpected skip');
    expect(r.status).toBe('SUCCESS');
    expect(r.stats.boardImport).toBeNull();
    expect(r.stats.totals.newJobs).toBe(3);
  });

  it('skips when another run holds the lease', async () => {
    await orchestrator.acquireLease(new Date(), 'cron');
    const r = await orchestrator.run({ trigger: 'manual' });
    expect(r).toEqual({ status: 'SKIPPED', reason: 'another_run_active' });
  });
});
