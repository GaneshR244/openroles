import { Injectable } from '@nestjs/common';
import { Prisma } from '../generated/prisma/client.js';
import { JobStatus } from '../generated/prisma/enums.js';
import type { JobSource } from '../generated/prisma/enums.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type { NormalizedJob, PreparedBatch, SeenJob } from './pipeline/pipeline.types.js';

// Writes jobs with batched SQL (docs/ARCHITECTURE.md §3.7).
// Correctness never depends on memory: the unique keys (source + externalId, fingerprint)
// make every write safe to repeat.

const CHUNK = 1000; // keeps each statement well under PostgreSQL's 65,535-parameter limit

export type SaveOptions = {
  source: JobSource;
  now: Date;
  /** Board jobs: the board and its company. LinkedIn jobs: neither. */
  boardId?: string;
  companyId?: string;
  /** How new companies were found ("linkedin", "board", …). */
  discoveredVia: string;
};

export type SaveResult = { touched: number; inserted: number; newCompanies: number };

export function chunk<T>(items: readonly T[], size = CHUNK): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

@Injectable()
export class JobStoreService {
  constructor(private readonly prisma: PrismaService) {}

  /** Saves one prepared batch: touch everything seen, then insert what's new. */
  async saveBatch(batch: PreparedBatch, opts: SaveOptions): Promise<SaveResult> {
    const touched = await this.touch(batch.seen, opts.source, opts.now);
    if (batch.kept.length === 0) return { touched, inserted: 0, newCompanies: 0 };

    let companyIds: Map<string, string>;
    let newCompanies = 0;
    if (opts.companyId) {
      companyIds = new Map(batch.kept.map((j) => [j.normalizedCompany, opts.companyId!]));
    } else {
      const upserted = await this.upsertCompanies(batch.kept, opts.discoveredVia);
      companyIds = upserted.ids;
      newCompanies = upserted.created;
    }

    const inserted = await this.insertJobs(batch.kept, companyIds, opts);
    return { touched, inserted, newCompanies };
  }

  /**
   * Refreshes "last seen" (and reopens) every existing job matching a fetched job by
   * fingerprint or by (source, externalId). Runs before any filtering, so a job that is
   * old but still open is never mistaken for a removed one.
   */
  async touch(seen: readonly SeenJob[], source: JobSource, now: Date): Promise<number> {
    let count = 0;
    for (const part of chunk(seen)) {
      const result = await this.prisma.job.updateMany({
        where: {
          OR: [
            { fingerprint: { in: part.map((s) => s.fingerprint) } },
            { source, externalId: { in: part.map((s) => s.externalId) } },
          ],
        },
        data: { lastSeenAt: now, status: JobStatus.ACTIVE, closedAt: null },
      });
      count += result.count;
    }
    return count;
  }

  /** Touches every open job of a board whose job list didn't change (one query). */
  async touchBoard(boardId: string, now: Date): Promise<number> {
    const result = await this.prisma.job.updateMany({
      where: { boardId, status: JobStatus.ACTIVE },
      data: { lastSeenAt: now },
    });
    return result.count;
  }

  /**
   * Creates missing companies in one statement, then maps normalized name → id.
   * Two queries per batch, never one per company.
   */
  async upsertCompanies(
    jobs: readonly NormalizedJob[],
    discoveredVia: string,
  ): Promise<{ ids: Map<string, string>; created: number }> {
    const byName = new Map<string, NormalizedJob>();
    for (const job of jobs)
      if (!byName.has(job.normalizedCompany)) byName.set(job.normalizedCompany, job);
    const names = [...byName.keys()];

    let created = 0;
    for (const part of chunk(names)) {
      const result = await this.prisma.company.createMany({
        data: part.map((n) => {
          const job = byName.get(n)!;
          return {
            name: job.companyName,
            normalizedName: n,
            linkedinUrl: job.companyLinkedinUrl ?? null,
            discoveredVia,
          };
        }),
        skipDuplicates: true,
      });
      created += result.count;
    }

    const ids = new Map<string, string>();
    const missingUrl: { id: string; url: string }[] = [];
    for (const part of chunk(names)) {
      const rows = await this.prisma.company.findMany({
        where: { normalizedName: { in: part } },
        select: { id: true, normalizedName: true, linkedinUrl: true },
      });
      for (const row of rows) {
        ids.set(row.normalizedName, row.id);
        const url = byName.get(row.normalizedName)?.companyLinkedinUrl;
        if (!row.linkedinUrl && url) missingUrl.push({ id: row.id, url });
      }
    }
    for (const { id, url } of missingUrl) {
      await this.prisma.company.update({ where: { id }, data: { linkedinUrl: url } });
    }
    return { ids, created };
  }

  /** Inserts jobs, skipping any that break a unique key. Returns how many were new. */
  async insertJobs(
    jobs: readonly NormalizedJob[],
    companyIds: ReadonlyMap<string, string>,
    opts: SaveOptions,
  ): Promise<number> {
    let inserted = 0;
    for (const part of chunk(jobs)) {
      const data = part.flatMap((job) => {
        const companyId = companyIds.get(job.normalizedCompany);
        if (!companyId) return [];
        return [
          {
            source: job.source,
            externalId: job.externalId,
            fingerprint: job.fingerprint,
            title: job.title,
            location: job.location,
            country: job.country,
            workMode: job.workMode,
            url: job.url,
            postedAt: job.postedAt,
            firstSeenAt: opts.now,
            lastSeenAt: opts.now,
            companyId,
            boardId: opts.boardId ?? null,
          },
        ];
      });
      if (data.length === 0) continue;
      const result = await this.prisma.job.createMany({ data, skipDuplicates: true });
      inserted += result.count;
    }
    return inserted;
  }

  /**
   * Reposts: a board row whose role (fingerprint) is still listed today, but under a new ID,
   * is pointed at the live posting so its link works and it is not closed as "missing".
   * Covers "same job reposted with a new ID" and "two openings, one closed".
   */
  async relinkReposts(
    boardId: string,
    kept: readonly NormalizedJob[],
    currentExternalIds: readonly string[],
    now: Date,
  ): Promise<number> {
    const current = new Set(currentExternalIds);
    const live = new Map(kept.map((j) => [j.fingerprint, j]));
    let relinked = 0;
    for (const part of chunk([...live.keys()])) {
      const rows = await this.prisma.job.findMany({
        where: { boardId, fingerprint: { in: part } },
        select: { id: true, externalId: true, fingerprint: true },
      });
      for (const row of rows) {
        if (current.has(row.externalId)) continue;
        const job = live.get(row.fingerprint)!;
        try {
          await this.prisma.job.update({
            where: { id: row.id },
            data: {
              externalId: job.externalId,
              url: job.url,
              postedAt: job.postedAt,
              status: JobStatus.ACTIVE,
              closedAt: null,
              lastSeenAt: now,
            },
          });
          relinked++;
        } catch (err) {
          // Another row already owns that (source, externalId): leave both as they are.
          if (!(err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002')) {
            throw err;
          }
        }
      }
    }
    return relinked;
  }

  /**
   * Set difference for one board: open jobs whose ID is not in today's response are closed,
   * unless their role (fingerprint) is still listed. Call only after a successful, complete
   * read; the board lane applies the empty-response and truncation guards.
   */
  async closeMissing(
    boardId: string,
    currentExternalIds: readonly string[],
    now: Date,
    currentFingerprints: readonly string[] = [],
  ): Promise<number> {
    const result = await this.prisma.job.updateMany({
      where: {
        boardId,
        status: JobStatus.ACTIVE,
        externalId: { notIn: [...currentExternalIds] },
        ...(currentFingerprints.length ? { fingerprint: { notIn: [...currentFingerprints] } } : {}),
      },
      data: { status: JobStatus.CLOSED, closedAt: now },
    });
    return result.count;
  }

  /** Closes every open job of a board (used when a board is marked BROKEN). */
  async closeAll(boardId: string, now: Date): Promise<number> {
    const result = await this.prisma.job.updateMany({
      where: { boardId, status: JobStatus.ACTIVE },
      data: { status: JobStatus.CLOSED, closedAt: now },
    });
    return result.count;
  }

  /** Number of open jobs currently stored for a board. */
  async countOpen(boardId: string): Promise<number> {
    return this.prisma.job.count({ where: { boardId, status: JobStatus.ACTIVE } });
  }
}
