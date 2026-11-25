import type { TestingModule } from '@nestjs/testing';
import { JobStoreService } from '../src/ingestion/job-store.service.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { batchOf, createTestingApp, job, resetDb } from './helpers/db.js';

describe('JobStoreService (integration, real PostgreSQL)', () => {
  let moduleRef: TestingModule;
  let store: JobStoreService;
  let prisma: PrismaService;
  const day1 = new Date('2026-11-24T00:40:00Z');
  const day2 = new Date('2026-11-25T00:40:00Z');

  beforeAll(async () => {
    moduleRef = await createTestingApp([JobStoreService]);
    store = moduleRef.get(JobStoreService);
    prisma = moduleRef.get(PrismaService);
  });

  beforeEach(async () => {
    await resetDb(prisma);
  });

  afterAll(async () => {
    await moduleRef.close();
  });

  async function boardFor(slug: string) {
    const company = await prisma.company.create({
      data: { name: 'Acme Payments', normalizedName: 'acme payments', discoveredVia: 'board' },
    });
    const board = await prisma.board.create({
      data: { ats: 'GREENHOUSE', slug, companyId: company.id },
    });
    return { company, board };
  }

  it('today 10, tomorrow 15: only the 5 new jobs are inserted', async () => {
    const { company, board } = await boardFor('acme');
    const opts = {
      source: 'GREENHOUSE' as const,
      boardId: board.id,
      companyId: company.id,
      discoveredVia: 'board',
    };
    const first10 = Array.from({ length: 10 }, (_, i) => job({ externalId: `g${i}` }));
    const all15 = [
      ...first10,
      ...Array.from({ length: 5 }, (_, i) => job({ externalId: `g${10 + i}` })),
    ];

    const r1 = await store.saveBatch(batchOf(first10), { ...opts, now: day1 });
    expect(r1).toEqual({ touched: 0, inserted: 10, newCompanies: 0 });

    const r2 = await store.saveBatch(batchOf(all15), { ...opts, now: day2 });
    expect(r2.inserted).toBe(5);
    expect(r2.touched).toBe(10);

    const newOnDay2 = await prisma.job.count({ where: { firstSeenAt: day2 } });
    expect(newOnDay2).toBe(5);
    const r3 = await store.saveBatch(batchOf(all15), { ...opts, now: day2 });
    expect(r3.inserted).toBe(0);
  });

  it('the same role from a second source is not saved twice (fingerprint)', async () => {
    const { company, board } = await boardFor('acme');
    const ghJob = job({ externalId: '7301142', title: 'Senior Backend Engineer' });
    await store.saveBatch(batchOf([ghJob]), {
      source: 'GREENHOUSE',
      boardId: board.id,
      companyId: company.id,
      discoveredVia: 'board',
      now: day1,
    });

    const liJob = job({
      externalId: '4087731256',
      source: 'LINKEDIN',
      title: 'Senior Backend Engineer',
      fingerprint: ghJob.fingerprint,
      companyLinkedinUrl: 'https://www.linkedin.com/company/acme',
    });
    const r = await store.saveBatch(batchOf([liJob]), {
      source: 'LINKEDIN',
      discoveredVia: 'linkedin',
      now: day2,
    });
    expect(r.inserted).toBe(0);
    expect(r.touched).toBe(1);
    expect(await prisma.job.count()).toBe(1);
    // the LinkedIn company URL is filled in on the existing company
    const c = await prisma.company.findUniqueOrThrow({
      where: { normalizedName: 'acme payments' },
    });
    expect(c.linkedinUrl).toBe('https://www.linkedin.com/company/acme');
  });

  it('creates each company once and links LinkedIn jobs to it', async () => {
    const jobs = [
      job({
        externalId: 'l1',
        source: 'LINKEDIN',
        companyName: 'Northwind Logistics',
        normalizedCompany: 'northwind logistics',
      }),
      job({
        externalId: 'l2',
        source: 'LINKEDIN',
        companyName: 'Northwind Logistics Pvt Ltd',
        normalizedCompany: 'northwind logistics',
        title: 'Recruiter',
      }),
      job({
        externalId: 'l3',
        source: 'LINKEDIN',
        companyName: 'Kestrel Staffing',
        normalizedCompany: 'kestrel staffing',
      }),
    ];
    const r1 = await store.saveBatch(batchOf(jobs), {
      source: 'LINKEDIN',
      discoveredVia: 'linkedin',
      now: day1,
    });
    expect(r1).toEqual({ touched: 0, inserted: 3, newCompanies: 2 });
    const r2 = await store.saveBatch(batchOf(jobs), {
      source: 'LINKEDIN',
      discoveredVia: 'linkedin',
      now: day2,
    });
    expect(r2).toEqual({ touched: 3, inserted: 0, newCompanies: 0 });
    const northwind = await prisma.company.findUniqueOrThrow({
      where: { normalizedName: 'northwind logistics' },
      include: { jobs: true },
    });
    expect(northwind.name).toBe('Northwind Logistics'); // first display name wins
    expect(northwind.jobs).toHaveLength(2);
  });

  it('closes jobs removed from a board, and reopens one that comes back', async () => {
    const { company, board } = await boardFor('acme');
    const opts = {
      source: 'GREENHOUSE' as const,
      boardId: board.id,
      companyId: company.id,
      discoveredVia: 'board',
    };
    const [a, b, c, d] = ['A', 'B', 'C', 'D'].map((id) => job({ externalId: id }));
    await store.saveBatch(batchOf([a!, b!, c!, d!]), { ...opts, now: day1 });

    const e = job({ externalId: 'E' });
    await store.saveBatch(batchOf([b!, c!, d!, e]), { ...opts, now: day2 });
    const closed = await store.closeMissing(board.id, ['B', 'C', 'D', 'E'], day2);
    expect(closed).toBe(1);
    const jobA = await prisma.job.findFirstOrThrow({ where: { externalId: 'A' } });
    expect(jobA.status).toBe('CLOSED');
    expect(jobA.closedAt).toEqual(day2);
    expect(await store.countOpen(board.id)).toBe(4);

    // A reappears: touch reopens it
    const day3 = new Date('2026-11-26T00:40:00Z');
    await store.saveBatch(batchOf([a!, b!, c!, d!, e]), { ...opts, now: day3 });
    const reopened = await prisma.job.findFirstOrThrow({ where: { externalId: 'A' } });
    expect(reopened.status).toBe('ACTIVE');
    expect(reopened.closedAt).toBeNull();
  });

  it('touches old-but-open jobs even when they were filtered out of `kept`', async () => {
    const { company, board } = await boardFor('acme');
    const opts = {
      source: 'GREENHOUSE' as const,
      boardId: board.id,
      companyId: company.id,
      discoveredVia: 'board',
    };
    const old = job({ externalId: 'old' });
    await store.saveBatch(batchOf([old]), { ...opts, now: day1 });
    // next day the job is past the age limit: not kept, but still seen
    const r = await store.saveBatch(batchOf([], [old]), { ...opts, now: day2 });
    expect(r.touched).toBe(1);
    const row = await prisma.job.findFirstOrThrow({ where: { externalId: 'old' } });
    expect(row.lastSeenAt).toEqual(day2);
  });

  it('touchBoard refreshes every open job of an unchanged board in one query', async () => {
    const { company, board } = await boardFor('acme');
    const opts = {
      source: 'GREENHOUSE' as const,
      boardId: board.id,
      companyId: company.id,
      discoveredVia: 'board',
    };
    await store.saveBatch(batchOf([job({ externalId: '1' }), job({ externalId: '2' })]), {
      ...opts,
      now: day1,
    });
    expect(await store.touchBoard(board.id, day2)).toBe(2);
  });

  it('inserts in chunks: 2,500 jobs in one batch', async () => {
    const { company, board } = await boardFor('big');
    const many = Array.from({ length: 2500 }, (_, i) => job({ externalId: `b${i}` }));
    const r = await store.saveBatch(batchOf(many), {
      source: 'GREENHOUSE',
      boardId: board.id,
      companyId: company.id,
      discoveredVia: 'board',
      now: day1,
    });
    expect(r.inserted).toBe(2500);
    expect(await prisma.job.count()).toBe(2500);
  });
});
