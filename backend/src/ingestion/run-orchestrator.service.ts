import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '../generated/prisma/client.js';
import type { Ats, RunStatus } from '../generated/prisma/enums.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { type AppConfig, setting } from '../config/app-config.js';
import { BoardLaneService, type BoardLaneStats } from './board-lane.service.js';
import { BoardFinderService } from './board-finder.service.js';
import { BoardImportService, type BoardImportStats } from './board-import.service.js';
import {
  LinkedInLaneService,
  disabledLinkedInStats,
  type LinkedInStats,
} from './linkedin-lane.service.js';
import { RetentionService } from './retention.service.js';
import { ReporterService } from './reporter.service.js';
import { decideStatus, type RunStats } from './run-stats.js';

// The morning run (docs/ARCHITECTURE.md §3.11): lease → board import (monthly) → lanes → board
// finder → second board pass → retention → report. Every step is safe to repeat.

const HOUR = 3_600_000;
const STALE_LEASE_MS = 10 * 60_000;
const HEARTBEAT_MS = 60_000;

export type RunOptions = {
  trigger: 'cron' | 'manual';
  /** Run one board system only (skips the board import, LinkedIn and the board finder). */
  only?: Ats;
  /** Common Crawl board import: 'auto' runs it when due (monthly), 'force' always, 'skip' never. */
  importBoards?: 'auto' | 'force' | 'skip';
  /** Clock override for tests. */
  now?: Date;
};

export type RunResult =
  | { status: RunStatus; runId: string; stats: RunStats; summary: string }
  | { status: 'SKIPPED'; reason: 'another_run_active' };

/** LinkedIn "posted since" window: since the last good run, minus 1 h overlap, kept within [24 h, max age]. */
export function windowSeconds(now: Date, lastGoodStart: Date | null, maxAgeDays: number): number {
  const min = 24 * 3600;
  const max = maxAgeDays * 24 * 3600;
  if (!lastGoodStart) return min;
  const secs = Math.ceil((now.getTime() - lastGoodStart.getTime() + HOUR) / 1000);
  return Math.min(Math.max(secs, min), max);
}

@Injectable()
export class RunOrchestratorService {
  private readonly logger = new Logger(RunOrchestratorService.name);
  private readonly config: AppConfig;

  constructor(
    private readonly prisma: PrismaService,
    private readonly boardLane: BoardLaneService,
    private readonly finder: BoardFinderService,
    private readonly boardImport: BoardImportService,
    private readonly linkedin: LinkedInLaneService,
    private readonly retention: RetentionService,
    private readonly reporter: ReporterService,
    config: ConfigService,
  ) {
    this.config = config as unknown as AppConfig;
  }

  async run(opts: RunOptions): Promise<RunResult> {
    const startedAt = opts.now ?? new Date();
    const run = await this.acquireLease(startedAt, opts.trigger);
    if (!run) {
      this.logger.warn('another run is active; exiting');
      return { status: 'SKIPPED', reason: 'another_run_active' };
    }

    const heartbeat = setInterval(() => {
      this.prisma.fetchRun
        .update({ where: { id: run.id }, data: { heartbeatAt: new Date() } })
        .catch((err: Error) => this.logger.warn(`heartbeat failed: ${err.message}`));
    }, HEARTBEAT_MS);
    heartbeat.unref();

    try {
      const deadline = new Date(
        startedAt.getTime() + setting(this.config, 'RUN_DEADLINE_MINUTES') * 60_000,
      );
      const lastGood = await this.prisma.fetchRun.findFirst({
        where: { status: { in: ['SUCCESS', 'PARTIAL'] }, id: { not: run.id } },
        orderBy: { startedAt: 'desc' },
        select: { startedAt: true },
      });
      const seconds = windowSeconds(
        startedAt,
        lastGood?.startedAt ?? null,
        setting(this.config, 'MAX_JOB_AGE_DAYS'),
      );
      const linkedinEnabled = setting(this.config, 'LINKEDIN_ENABLED') && !opts.only;
      const boardImport = await this.importBoards(opts, startedAt, deadline);

      // Lanes run in parallel: they call different hosts.
      const [boardsResult, linkedinResult] = await Promise.allSettled([
        this.boardLane.run({ now: startedAt, deadline, only: opts.only }),
        linkedinEnabled
          ? this.linkedin.run({ now: startedAt, deadline, windowSeconds: seconds })
          : Promise.resolve(disabledLinkedInStats()),
      ]);
      if (boardsResult.status === 'rejected') throw boardsResult.reason;
      const boards = boardsResult.value;
      let linkedin: LinkedInStats;
      if (linkedinResult.status === 'fulfilled') {
        linkedin = linkedinResult.value;
      } else {
        this.logger.error(`linkedin lane failed: ${(linkedinResult.reason as Error)?.message}`);
        linkedin = { ...disabledLinkedInStats(), enabled: true, errors: 1 };
      }

      let finder = null;
      let boardsSecondPass: BoardLaneStats | null = null;
      if (!opts.only) {
        finder = await this.finder.run({ now: startedAt, deadline });
        if (finder.boardsFound > 0) {
          boardsSecondPass = await this.boardLane.run({
            now: startedAt,
            deadline,
            createdSince: startedAt,
          });
        }
      }

      const retention = await this.retention.run(startedAt);
      const newCompanies = await this.prisma.company.count({
        where: { createdAt: { gte: startedAt } },
      });
      const base = {
        window: { since: new Date(startedAt.getTime() - seconds * 1000).toISOString(), seconds },
        boardImport,
        linkedin,
        boards,
        boardsSecondPass,
        finder,
        retention,
        totals: {
          newJobs: boards.new + (boardsSecondPass?.new ?? 0) + linkedin.new,
          newCompanies,
        },
      };
      const { status, reasons } = decideStatus(base);
      const stats: RunStats = {
        ...base,
        durationMs: Date.now() - startedAt.getTime(),
        partialReasons: reasons,
      };
      // Keep the stats JSON-safe for the database.
      await this.finish(run.id, status, stats);
      // The run is already saved; a reporting problem must not turn it into FAILED.
      const summary = await this.reporter
        .report(run.id, status, stats, startedAt)
        .catch((err: Error) => {
          this.logger.warn(`report failed: ${err.message}`);
          return `OpenRoles run ${status}`;
        });
      return { status, runId: run.id, stats, summary };
    } catch (err) {
      const message = (err as Error)?.message ?? String(err);
      this.logger.error(`run failed: ${message}`);
      await this.prisma.fetchRun.update({
        where: { id: run.id },
        data: { status: 'FAILED', finishedAt: new Date(), error: message.slice(0, 2000) },
      });
      await this.reporter.alertFailure(message).catch(() => undefined);
      throw err;
    } finally {
      clearInterval(heartbeat);
    }
  }

  /** The monthly Common Crawl board import. A failure is logged and never stops the run. */
  private async importBoards(
    opts: RunOptions,
    now: Date,
    deadline: Date,
  ): Promise<BoardImportStats | null> {
    const mode = opts.importBoards ?? 'auto';
    if (opts.only || mode === 'skip') return null;
    try {
      if (mode === 'auto' && !(await this.boardImport.isDue(now))) return null;
      return await this.boardImport.run({ now, deadline });
    } catch (err) {
      this.logger.error(`board import failed: ${(err as Error)?.message ?? err}`);
      return null;
    }
  }

  /**
   * Lease: mark runs whose heartbeat stopped as FAILED, then insert a RUNNING row. The partial
   * unique index (one RUNNING row at most) turns a second concurrent start into a unique error.
   */
  async acquireLease(now: Date, trigger: string): Promise<{ id: string } | null> {
    await this.prisma.fetchRun.updateMany({
      where: { status: 'RUNNING', heartbeatAt: { lt: new Date(now.getTime() - STALE_LEASE_MS) } },
      data: {
        status: 'FAILED',
        finishedAt: now,
        error: 'stale lease: the process stopped without finishing',
      },
    });
    try {
      return await this.prisma.fetchRun.create({
        data: { trigger, startedAt: now, heartbeatAt: now },
        select: { id: true },
      });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') return null;
      throw err;
    }
  }

  private async finish(runId: string, status: RunStatus, stats: RunStats): Promise<void> {
    await this.prisma.fetchRun.update({
      where: { id: runId },
      data: { status, finishedAt: new Date(), stats: JSON.parse(JSON.stringify(stats)) },
    });
  }
}
