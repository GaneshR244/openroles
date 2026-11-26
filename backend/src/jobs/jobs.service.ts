import { Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '../generated/prisma/client.js';
import type { JobSource } from '../generated/prisma/enums.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { type AppConfig, setting } from '../config/app-config.js';
import { addDays, daysBefore, startOfIstDay } from '../common/time.js';
import { jobQuerySchema, type JobQuery } from './jobs.schemas.js';
import type {
  CompanyItem,
  CountryCount,
  JobItem,
  JobSummary,
  Paged,
  RunSummary,
} from './jobs.types.js';

// Read-only queries for the sales page. Every filter maps onto an index (docs/ARCHITECTURE.md §3.13).

const STALE_HEARTBEAT_MS = 10 * 60_000;
/** Board jobs not seen for this long are hidden: boards are re-read at least every 7 days. */
const BOARD_FRESH_DAYS = 8;

const jobSelect = {
  id: true,
  title: true,
  location: true,
  country: true,
  workMode: true,
  url: true,
  source: true,
  postedAt: true,
  firstSeenAt: true,
  company: { select: { id: true, name: true } },
} satisfies Prisma.JobSelect;

type JobRow = Prisma.JobGetPayload<{ select: typeof jobSelect }>;

function toJobItem(j: JobRow): JobItem {
  return { ...j, postedAt: j.postedAt.toISOString(), firstSeenAt: j.firstSeenAt.toISOString() };
}

/** Escapes LIKE wildcards so a search for "100%" means the text, not a pattern. */
export function likePattern(q: string): string {
  return `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}

@Injectable()
export class JobsService {
  private readonly config: AppConfig;

  constructor(
    private readonly prisma: PrismaService,
    config: ConfigService,
  ) {
    this.config = config as unknown as AppConfig;
  }

  private cutoff(now: Date): Date {
    return daysBefore(now, setting(this.config, 'MAX_JOB_AGE_DAYS'));
  }

  /**
   * Countries with open roles (the same jobs as the "All open" view), most roles first. Jobs
   * with no known country are left out.
   */
  async countries(now: Date = new Date()): Promise<CountryCount[]> {
    const allOpen = this.jobWhere(jobQuerySchema.parse({ view: 'all' }), now);
    const rows = await this.prisma.job.groupBy({
      by: ['country'],
      where: { ...allOpen, country: { not: null } },
      _count: { _all: true },
      orderBy: { _count: { country: 'desc' } },
    });
    return rows.map((r) => ({ code: r.country!, jobs: r._count._all }));
  }

  /** Time window per view: new = first seen since IST midnight, week = last 7 IST days, all = posted within the age limit. */
  jobWhere(q: JobQuery, now: Date): Prisma.JobWhereInput {
    const today = startOfIstDay(now);
    const where: Prisma.JobWhereInput = { status: 'ACTIVE', postedAt: { gte: this.cutoff(now) } };
    if (q.view === 'new') where.firstSeenAt = { gte: today };
    if (q.view === 'week') where.firstSeenAt = { gte: addDays(today, -6) };
    if (q.country) where.country = q.country;
    if (q.workMode) where.workMode = q.workMode;
    if (q.source) where.source = q.source;
    const and: Prisma.JobWhereInput[] = [
      { OR: [{ boardId: null }, { lastSeenAt: { gte: daysBefore(now, BOARD_FRESH_DAYS) } }] },
    ];
    if (q.q) {
      and.push({
        OR: [
          { title: { contains: q.q, mode: 'insensitive' } },
          { company: { name: { contains: q.q, mode: 'insensitive' } } },
        ],
      });
    }
    where.AND = and;
    return where;
  }

  async listJobs(q: JobQuery, now = new Date()): Promise<Paged<JobItem>> {
    const where = this.jobWhere(q, now);
    const orderBy: Prisma.JobOrderByWithRelationInput[] =
      q.view === 'all'
        ? [{ postedAt: 'desc' }, { id: 'desc' }]
        : [{ firstSeenAt: 'desc' }, { id: 'desc' }];
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.job.findMany({
        where,
        orderBy,
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
        select: jobSelect,
      }),
      this.prisma.job.count({ where }),
    ]);
    return { items: rows.map(toJobItem), total, page: q.page, pageSize: q.pageSize };
  }

  /** The page's filters as SQL, for the raw queries (alias j = Job, c = Company). */
  private sqlWhere(q: JobQuery, now: Date): Prisma.Sql {
    const today = startOfIstDay(now);
    const conditions: Prisma.Sql[] = [
      Prisma.sql`j."status" = 'ACTIVE'`,
      Prisma.sql`j."postedAt" >= ${this.cutoff(now)}`,
      Prisma.sql`(j."boardId" IS NULL OR j."lastSeenAt" >= ${daysBefore(now, BOARD_FRESH_DAYS)})`,
    ];
    if (q.view === 'new') conditions.push(Prisma.sql`j."firstSeenAt" >= ${today}`);
    if (q.view === 'week') conditions.push(Prisma.sql`j."firstSeenAt" >= ${addDays(today, -6)}`);
    if (q.country) conditions.push(Prisma.sql`j."country" = ${q.country}`);
    if (q.workMode) conditions.push(Prisma.sql`j."workMode" = ${q.workMode}::"WorkMode"`);
    if (q.source) conditions.push(Prisma.sql`j."source" = ${q.source}::"JobSource"`);
    if (q.q) {
      const p = likePattern(q.q);
      conditions.push(Prisma.sql`(j."title" ILIKE ${p} OR c."name" ILIKE ${p})`);
    }
    return Prisma.join(conditions, ' AND ');
  }

  /** Totals for the page's summary line: roles, companies and countries for these filters. */
  async summary(q: JobQuery, now = new Date()): Promise<JobSummary> {
    const [row] = await this.prisma.$queryRaw<JobSummary[]>`
      SELECT COUNT(*)::int AS "roles",
             COUNT(DISTINCT j."companyId")::int AS "companies",
             COUNT(DISTINCT j."country")::int AS "countries"
      FROM "Job" j JOIN "Company" c ON c."id" = j."companyId"
      WHERE ${this.sqlWhere(q, now)}`;
    return row ?? { roles: 0, companies: 0, countries: 0 };
  }

  /** Same filters, one row per company. Raw SQL because Prisma can't group with a filtered count. */
  async listCompanies(q: JobQuery, now = new Date()): Promise<Paged<CompanyItem>> {
    const today = startOfIstDay(now);
    const where = this.sqlWhere(q, now);

    const rows = await this.prisma.$queryRaw<
      {
        id: string;
        name: string;
        linkedinUrl: string | null;
        openRoles: number;
        newToday: number;
        latestPostedAt: Date | null;
        sources: JobSource[];
      }[]
    >`
      SELECT c."id", c."name", c."linkedinUrl",
             COUNT(*)::int AS "openRoles",
             (COUNT(*) FILTER (WHERE j."firstSeenAt" >= ${today}))::int AS "newToday",
             MAX(j."postedAt") AS "latestPostedAt",
             ARRAY_AGG(DISTINCT j."source"::text) AS "sources"
      FROM "Job" j JOIN "Company" c ON c."id" = j."companyId"
      WHERE ${where}
      GROUP BY c."id"
      ORDER BY "newToday" DESC, "openRoles" DESC, c."name" ASC
      LIMIT ${q.pageSize} OFFSET ${(q.page - 1) * q.pageSize}`;
    const [{ total }] = await this.prisma.$queryRaw<{ total: number }[]>`
      SELECT COUNT(DISTINCT j."companyId")::int AS "total"
      FROM "Job" j JOIN "Company" c ON c."id" = j."companyId"
      WHERE ${where}`;

    return {
      items: rows.map((r) => ({ ...r, latestPostedAt: r.latestPostedAt?.toISOString() ?? null })),
      total: total ?? 0,
      page: q.page,
      pageSize: q.pageSize,
    };
  }

  async companyJobs(
    id: string,
    now = new Date(),
  ): Promise<{ company: CompanyItem; jobs: JobItem[] }> {
    const company = await this.prisma.company.findUnique({
      where: { id },
      select: { id: true, name: true, linkedinUrl: true },
    });
    if (!company) throw new NotFoundException('Company not found');
    const rows = await this.prisma.job.findMany({
      where: {
        companyId: id,
        status: 'ACTIVE',
        postedAt: { gte: this.cutoff(now) },
        OR: [{ boardId: null }, { lastSeenAt: { gte: daysBefore(now, BOARD_FRESH_DAYS) } }],
      },
      orderBy: [{ postedAt: 'desc' }, { id: 'desc' }],
      select: jobSelect,
    });
    const today = startOfIstDay(now);
    const latest = rows[0]?.postedAt ?? null;
    return {
      company: {
        ...company,
        openRoles: rows.length,
        newToday: rows.filter((r) => r.firstSeenAt >= today).length,
        latestPostedAt: latest?.toISOString() ?? null,
        sources: [...new Set(rows.map((r) => r.source))],
      },
      jobs: rows.map(toJobItem),
    };
  }

  async latestRun(now = new Date()): Promise<RunSummary> {
    const today = startOfIstDay(now);
    const [last, running, todayCounts] = await Promise.all([
      this.prisma.fetchRun.findFirst({
        where: { status: { not: 'RUNNING' }, finishedAt: { not: null } },
        orderBy: { startedAt: 'desc' },
      }),
      this.prisma.fetchRun.count({
        where: {
          status: 'RUNNING',
          heartbeatAt: { gte: new Date(now.getTime() - STALE_HEARTBEAT_MS) },
        },
      }),
      this.prisma.$queryRaw<{ newJobs: number; companies: number }[]>`
        SELECT COUNT(*)::int AS "newJobs", COUNT(DISTINCT "companyId")::int AS "companies"
        FROM "Job" WHERE "status" = 'ACTIVE' AND "firstSeenAt" >= ${today}`,
    ]);
    const totals = (last?.stats as { totals?: { newJobs?: number; newCompanies?: number } } | null)
      ?.totals;
    return {
      lastRun: last
        ? {
            id: last.id,
            status: last.status,
            startedAt: last.startedAt.toISOString(),
            finishedAt: last.finishedAt?.toISOString() ?? null,
            newJobs: totals?.newJobs ?? 0,
            newCompanies: totals?.newCompanies ?? 0,
          }
        : null,
      isRunning: running > 0,
      today: todayCounts[0] ?? { newJobs: 0, companies: 0 },
    };
  }
}
