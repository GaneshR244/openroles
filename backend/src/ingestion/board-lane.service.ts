import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash } from 'node:crypto';
import { BoardStatus } from '../generated/prisma/enums.js';
import type { Ats, JobSource } from '../generated/prisma/enums.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { type AppConfig, setting } from '../config/app-config.js';
import {
  HttpError,
  NetworkError,
  ServerError,
  TimeoutError,
  isHostBlockedError,
} from '../common/http/errors.js';
import { runPool } from '../common/pool.js';
import { addDays, startOfIstDay } from '../common/time.js';
import { BoardReaders } from './sources/board-readers.js';
import type { BoardRead } from './sources/source.types.js';
import { JobStoreService } from './job-store.service.js';
import { prepareBatch } from './pipeline/filter.js';
import { COMPANY_BLOCKLIST } from './sources.config.js';
import type { DropReason } from './pipeline/pipeline.types.js';

// Reads every due company board, 5 at a time (docs/ARCHITECTURE.md §3.8).

const WORKERS = 5;
const MAX_INTERVAL_DAYS = 7;
const FAILS_BEFORE_BROKEN = 3;
const BROKEN_RETRY_DAYS = 7; // broken boards are retried weekly, so an outage heals itself
const EMPTY_READS_BEFORE_CLOSE_ALL = 2;
const MAX_ERRORS_KEPT = 50;

export type BoardLaneOptions = {
  now: Date;
  deadline: Date;
  /** Second pass: only boards created at or after this time (found earlier in this run). */
  createdSince?: Date;
  /** Read one board system only (manual runs with --source). */
  only?: Ats;
};

export type BoardLaneStats = {
  due: number;
  read: number;
  unchanged: number;
  failed: number;
  /** Host-level problem (rate limit, block, timeout, network, 5xx): retried tomorrow, not counted against the board. */
  transient: number;
  broken: number;
  /** Read stopped at the page cap: jobs saved, but nothing closed. */
  truncated: number;
  suspiciousEmpty: number;
  new: number;
  closed: number;
  stoppedByDeadline: boolean;
  dropped: Record<DropReason, number>;
  errors: { ats: Ats; slug: string; code: string }[];
};

type DueBoard = {
  id: string;
  ats: Ats;
  slug: string;
  companyId: string;
  status: BoardStatus;
  failCount: number;
  emptyCount: number;
  fetchIntervalDays: number;
  lastJobsHash: string | null;
  openJobs: number;
  company: { name: string };
};

/** Host-level problems that say nothing about the board itself. */
export function isTransient(err: unknown): boolean {
  return (
    isHostBlockedError(err) ||
    err instanceof TimeoutError ||
    err instanceof NetworkError ||
    err instanceof ServerError
  );
}

/** sha1 of the sorted external IDs: equal hashes mean the board's job list didn't change. */
export function jobsHash(externalIds: readonly string[]): string {
  return createHash('sha1')
    .update([...externalIds].sort().join('\n'))
    .digest('hex');
}

/** Adaptive polling: back to daily on change, otherwise double up to 7 days. */
export function nextInterval(current: number, changed: boolean): number {
  return changed ? 1 : Math.min(Math.max(1, current) * 2, MAX_INTERVAL_DAYS);
}

/** Next check at IST midnight `days` from now, so boards line up with the morning run. */
export function nextFetchAt(now: Date, days: number): Date {
  return startOfIstDay(addDays(now, days));
}

function emptyStats(): BoardLaneStats {
  return {
    due: 0,
    read: 0,
    unchanged: 0,
    failed: 0,
    transient: 0,
    broken: 0,
    truncated: 0,
    suspiciousEmpty: 0,
    new: 0,
    closed: 0,
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
  };
}

@Injectable()
export class BoardLaneService {
  private readonly logger = new Logger(BoardLaneService.name);
  private readonly config: AppConfig;

  constructor(
    private readonly prisma: PrismaService,
    private readonly readers: BoardReaders,
    private readonly store: JobStoreService,
    config: ConfigService,
  ) {
    this.config = config as unknown as AppConfig;
  }

  async run(opts: BoardLaneOptions): Promise<BoardLaneStats> {
    const stats = emptyStats();
    const boards: DueBoard[] = await this.prisma.board.findMany({
      where: {
        status: { in: [BoardStatus.ACTIVE, BoardStatus.BROKEN] },
        nextFetchAt: { lte: opts.now },
        ...(opts.createdSince ? { createdAt: { gte: opts.createdSince } } : {}),
        ...(opts.only ? { ats: opts.only } : {}),
      },
      orderBy: { nextFetchAt: 'asc' }, // oldest due first: nothing starves
      take: setting(this.config, 'MAX_BOARDS_PER_RUN'),
      select: {
        id: true,
        ats: true,
        slug: true,
        companyId: true,
        status: true,
        failCount: true,
        emptyCount: true,
        fetchIntervalDays: true,
        lastJobsHash: true,
        openJobs: true,
        company: { select: { name: true } },
      },
    });
    stats.due = boards.length;

    const pastDeadline = () => {
      const stop = Date.now() >= opts.deadline.getTime();
      if (stop) stats.stoppedByDeadline = true;
      return stop;
    };
    await runPool(
      boards,
      WORKERS,
      (board) => this.processBoard(board, opts.now, stats),
      pastDeadline,
      (board, err) => {
        stats.failed++;
        this.logger.error(`board ${board.ats}/${board.slug}: ${(err as Error)?.message ?? err}`);
      },
    );

    this.logger.log(
      `boards: ${stats.due} due · ${stats.read} read · ${stats.unchanged} unchanged · ` +
        `${stats.failed} failed · ${stats.new} new · ${stats.closed} closed`,
    );
    return stats;
  }

  private async processBoard(board: DueBoard, now: Date, stats: BoardLaneStats): Promise<void> {
    let read: BoardRead;
    try {
      read = await this.readers.get(board.ats).read(board.slug);
    } catch (err) {
      await this.recordFailure(board, now, stats, err);
      return;
    }

    try {
      const raws = read.jobs;
      const ids = raws.map((r) => r.externalId);

      // Empty-response guard: a board that suddenly lists nothing may be a broken API.
      if (
        ids.length === 0 &&
        board.openJobs > 0 &&
        board.emptyCount + 1 < EMPTY_READS_BEFORE_CLOSE_ALL
      ) {
        stats.suspiciousEmpty++;
        await this.prisma.board.update({
          where: { id: board.id },
          data: {
            status: BoardStatus.ACTIVE,
            emptyCount: { increment: 1 },
            lastFetchedAt: now,
            nextFetchAt: nextFetchAt(now, 1),
          },
        });
        return;
      }

      // A truncated list is incomplete: never compare hashes or close jobs from it.
      const hash = read.truncated ? null : jobsHash(ids);
      if (hash !== null && hash === board.lastJobsHash) {
        stats.unchanged++;
        stats.read++;
        await this.store.touchBoard(board.id, now);
        const interval = nextInterval(board.fetchIntervalDays, false);
        await this.prisma.board.update({
          where: { id: board.id },
          data: {
            status: BoardStatus.ACTIVE,
            failCount: 0,
            emptyCount: 0,
            lastFetchedAt: now,
            fetchIntervalDays: interval,
            nextFetchAt: nextFetchAt(now, interval),
          },
        });
        return;
      }

      const batch = prepareBatch(raws, {
        now,
        maxAgeDays: setting(this.config, 'MAX_JOB_AGE_DAYS'),
        targetCountries: setting(this.config, 'TARGET_COUNTRIES'),
        companyName: board.company.name,
        isBoard: true,
        blocklist: COMPANY_BLOCKLIST,
      });
      for (const [reason, n] of Object.entries(batch.dropped))
        stats.dropped[reason as DropReason] += n;

      const saved = await this.store.saveBatch(batch, {
        source: board.ats as JobSource,
        boardId: board.id,
        companyId: board.companyId,
        discoveredVia: 'board',
        now,
      });
      // Reposts and duplicate openings keep their role open under the live posting's ID.
      await this.store.relinkReposts(board.id, batch.kept, ids, now);
      const closed = read.truncated
        ? 0
        : await this.store.closeMissing(
            board.id,
            ids,
            now,
            batch.seen.map((j) => j.fingerprint),
          );
      if (read.truncated) stats.truncated++;
      const openJobs = await this.store.countOpen(board.id);

      stats.read++;
      stats.new += saved.inserted;
      stats.closed += closed;
      await this.prisma.board.update({
        where: { id: board.id },
        data: {
          status: BoardStatus.ACTIVE,
          failCount: 0,
          emptyCount: 0,
          lastJobsHash: hash,
          openJobs,
          lastFetchedAt: now,
          fetchIntervalDays: nextInterval(board.fetchIntervalDays, true),
          nextFetchAt: nextFetchAt(now, 1),
        },
      });
    } catch (err) {
      await this.recordFailure(board, now, stats, err);
    }
  }

  /**
   * A failed read never closes jobs. Host-level problems are retried tomorrow without counting.
   * Three board-level failures in a row (404, changed format, other 4xx) mark the board BROKEN:
   * its jobs are closed (their links are likely dead) and it is retried weekly.
   */
  private async recordFailure(
    board: DueBoard,
    now: Date,
    stats: BoardLaneStats,
    err: unknown,
  ): Promise<void> {
    const code = err instanceof HttpError ? err.code : 'unexpected';
    if (stats.errors.length < MAX_ERRORS_KEPT)
      stats.errors.push({ ats: board.ats, slug: board.slug, code });

    // Not this board's fault (rate limit, block, timeout, network, 5xx): retry tomorrow
    // without counting a failure.
    if (isTransient(err)) {
      stats.transient++;
      await this.prisma.board.update({
        where: { id: board.id },
        data: { nextFetchAt: nextFetchAt(now, 1) },
      });
      return;
    }

    stats.failed++;
    if (!(err instanceof HttpError)) {
      this.logger.warn(
        `board ${board.ats}/${board.slug} failed: ${(err as Error)?.message ?? err}`,
      );
    }
    const failCount = board.failCount + 1;
    const broken = failCount >= FAILS_BEFORE_BROKEN;
    if (broken && board.status !== BoardStatus.BROKEN) {
      stats.broken++;
      stats.closed += await this.store.closeAll(board.id, now);
    }
    await this.prisma.board.update({
      where: { id: board.id },
      data: {
        failCount,
        status: broken ? BoardStatus.BROKEN : BoardStatus.ACTIVE,
        openJobs: broken ? 0 : undefined,
        // Forget the job list so the first good read after a break reopens jobs (full path).
        lastJobsHash: broken ? null : undefined,
        lastFetchedAt: now,
        nextFetchAt: nextFetchAt(now, broken ? BROKEN_RETRY_DAYS : 1),
      },
    });
  }
}
