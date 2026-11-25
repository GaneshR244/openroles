import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/app.setup.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { startOfIstDay } from '../src/common/time.js';
import { resetDb } from './helpers/db.js';

describe('Read API (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const key = process.env['API_KEY']!;
  const api = (path: string) => request(app.getHttpServer()).get(path).set('x-api-key', key);

  const now = new Date();
  const today = startOfIstDay(now);
  const hoursAgo = (h: number) => new Date(now.getTime() - h * 3_600_000);
  const daysAgo = (d: number) => new Date(now.getTime() - d * 86_400_000);
  let acmeId = '';

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();
    prisma = app.get(PrismaService);
    await resetDb(prisma);

    const acme = await prisma.company.create({
      data: {
        name: 'Acme Payments',
        normalizedName: 'acme payments',
        discoveredVia: 'board',
        linkedinUrl: 'https://www.linkedin.com/company/acme',
      },
    });
    const kestrel = await prisma.company.create({
      data: {
        name: 'Kestrel Staffing',
        normalizedName: 'kestrel staffing',
        discoveredVia: 'linkedin',
      },
    });
    acmeId = acme.id;
    const firstSeenToday = new Date(Math.max(today.getTime() + 60_000, hoursAgo(1).getTime()));
    const base = { status: 'ACTIVE' as const, url: 'https://example.com/j' };
    await prisma.job.createMany({
      data: [
        // today
        {
          ...base,
          source: 'GREENHOUSE',
          externalId: 'g1',
          fingerprint: 'f1',
          title: 'Senior Backend Engineer',
          location: 'Bengaluru, India',
          country: 'IN',
          workMode: 'HYBRID',
          postedAt: hoursAgo(5),
          firstSeenAt: firstSeenToday,
          companyId: acme.id,
        },
        {
          ...base,
          source: 'LINKEDIN',
          externalId: 'l1',
          fingerprint: 'f2',
          title: 'Recruiter, Bulk Hiring',
          location: 'Dubai, UAE',
          country: 'AE',
          workMode: 'ONSITE',
          postedAt: hoursAgo(3),
          firstSeenAt: firstSeenToday,
          companyId: kestrel.id,
        },
        // this week
        {
          ...base,
          source: 'LEVER',
          externalId: 'v1',
          fingerprint: 'f3',
          title: 'Inside Sales Executive',
          location: 'Austin, TX',
          country: 'US',
          workMode: 'REMOTE',
          postedAt: daysAgo(4),
          firstSeenAt: daysAgo(3),
          companyId: acme.id,
        },
        // older but still open
        {
          ...base,
          source: 'GREENHOUSE',
          externalId: 'g2',
          fingerprint: 'f4',
          title: '100% Remote Designer',
          location: 'Remote',
          country: null,
          workMode: 'REMOTE',
          postedAt: daysAgo(20),
          firstSeenAt: daysAgo(20),
          companyId: acme.id,
        },
        // excluded: closed, and too old
        {
          ...base,
          status: 'CLOSED',
          source: 'GREENHOUSE',
          externalId: 'g3',
          fingerprint: 'f5',
          title: 'Closed Role',
          location: 'Pune',
          country: 'IN',
          postedAt: daysAgo(2),
          firstSeenAt: daysAgo(2),
          companyId: acme.id,
        },
        {
          ...base,
          source: 'GREENHOUSE',
          externalId: 'g4',
          fingerprint: 'f6',
          title: 'Ancient Role',
          location: 'Pune',
          country: 'IN',
          postedAt: daysAgo(45),
          firstSeenAt: daysAgo(45),
          companyId: acme.id,
        },
      ],
    });
    // A board job whose board hasn't confirmed it for 10 days (e.g. a failing board) is hidden.
    const board = await prisma.board.create({
      data: { ats: 'GREENHOUSE', slug: 'acme', companyId: acme.id },
    });
    await prisma.job.create({
      data: {
        ...base,
        source: 'GREENHOUSE',
        externalId: 'g9',
        fingerprint: 'f9',
        title: 'Stale Board Role',
        location: 'Pune',
        country: 'IN',
        postedAt: daysAgo(12),
        firstSeenAt: daysAgo(12),
        lastSeenAt: daysAgo(10),
        companyId: acme.id,
        boardId: board.id,
      },
    });
    await prisma.fetchRun.create({
      data: {
        status: 'SUCCESS',
        startedAt: hoursAgo(2),
        finishedAt: hoursAgo(1),
        stats: { totals: { newJobs: 2, newCompanies: 1 } },
      },
    });
  });

  afterAll(async () => {
    await app.close();
  });

  it('rejects requests without the right API key; health stays public', async () => {
    await request(app.getHttpServer()).get('/api/jobs').expect(401);
    await request(app.getHttpServer()).get('/api/jobs').set('x-api-key', 'wrong').expect(401);
    await request(app.getHttpServer()).get('/api/health').expect(200);
  });

  it('views: new today, last 7 days, all open (closed and too-old jobs never show)', async () => {
    const newToday = await api('/api/jobs?view=new').expect(200);
    expect(newToday.body.total).toBe(2);
    const week = await api('/api/jobs?view=week').expect(200);
    expect(week.body.total).toBe(3);
    const all = await api('/api/jobs?view=all').expect(200);
    expect(all.body.items.map((j: { title: string }) => j.title)).toEqual([
      'Recruiter, Bulk Hiring',
      'Senior Backend Engineer',
      'Inside Sales Executive',
      '100% Remote Designer',
    ]);
    expect(all.headers['cache-control']).toBe('private, max-age=60');
  });

  it('returns the contract shape', async () => {
    const res = await api('/api/jobs?view=new&country=IN').expect(200);
    expect(res.body).toMatchObject({ total: 1, page: 1, pageSize: 50 });
    expect(res.body.items[0]).toEqual({
      id: expect.any(String),
      title: 'Senior Backend Engineer',
      company: { id: acmeId, name: 'Acme Payments' },
      location: 'Bengaluru, India',
      country: 'IN',
      workMode: 'HYBRID',
      url: 'https://example.com/j',
      source: 'GREENHOUSE',
      postedAt: expect.stringMatching(/Z$/),
      firstSeenAt: expect.stringMatching(/Z$/),
    });
  });

  it('filters by work mode, source and search text (wildcards are literal)', async () => {
    expect((await api('/api/jobs?view=all&workMode=REMOTE').expect(200)).body.total).toBe(2);
    expect((await api('/api/jobs?view=all&source=LINKEDIN').expect(200)).body.total).toBe(1);
    expect((await api('/api/jobs?view=all&q=kestrel').expect(200)).body.total).toBe(1);
    expect((await api('/api/jobs?view=all&q=backend').expect(200)).body.total).toBe(1);
    expect((await api('/api/jobs?view=all&q=100%25').expect(200)).body.total).toBe(1);
  });

  it('paginates', async () => {
    const p2 = await api('/api/jobs?view=all&pageSize=3&page=2').expect(200);
    expect(p2.body).toMatchObject({ total: 4, page: 2, pageSize: 3 });
    expect(p2.body.items).toHaveLength(1);
  });

  it('rejects bad query parameters with 400', async () => {
    await api('/api/jobs?view=yesterday').expect(400);
    await api('/api/jobs?country=FR').expect(400);
    await api('/api/jobs?pageSize=500').expect(400);
  });

  it('groups by company, most new roles first', async () => {
    const res = await api('/api/companies?view=all').expect(200);
    expect(res.body.total).toBe(2);
    const [first, second] = res.body.items;
    expect(first).toMatchObject({
      name: 'Acme Payments',
      openRoles: 3,
      newToday: 1,
      linkedinUrl: 'https://www.linkedin.com/company/acme',
    });
    expect([...first.sources].sort((a: string, b: string) => a.localeCompare(b))).toEqual([
      'GREENHOUSE',
      'LEVER',
    ]);
    expect(second).toMatchObject({
      name: 'Kestrel Staffing',
      openRoles: 1,
      newToday: 1,
      sources: ['LINKEDIN'],
    });
    const filtered = await api('/api/companies?view=all&country=AE').expect(200);
    expect(filtered.body.items.map((c: { name: string }) => c.name)).toEqual(['Kestrel Staffing']);
  });

  it('lists one company’s open roles, and 404s for an unknown company', async () => {
    const res = await api(`/api/companies/${acmeId}/jobs`).expect(200);
    expect(res.body.company).toMatchObject({ name: 'Acme Payments', openRoles: 3 });
    expect(res.body.jobs).toHaveLength(3);
    await api('/api/companies/does-not-exist/jobs').expect(404);
  });

  it('reports the latest run', async () => {
    const res = await api('/api/runs/latest').expect(200);
    expect(res.body).toMatchObject({
      isRunning: false,
      lastRun: { status: 'SUCCESS', newJobs: 2, newCompanies: 1 },
      today: { newJobs: 2, companies: 2 },
    });
  });

  it('hides board jobs not confirmed for over 8 days, but keeps LinkedIn-style jobs', async () => {
    const all = await api('/api/jobs?view=all&q=stale').expect(200);
    expect(all.body.total).toBe(0);
    const companies = await api('/api/companies?view=all').expect(200);
    const acme = companies.body.items.find((c: { name: string }) => c.name === 'Acme Payments');
    expect(acme.openRoles).toBe(3);
    // the 20-day-old job without a board (LinkedIn-style) is still listed
    expect((await api('/api/jobs?view=all&q=designer').expect(200)).body.total).toBe(1);
  });
});
