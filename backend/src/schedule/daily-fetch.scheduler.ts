import { Injectable, Logger, type OnApplicationBootstrap } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service.js';
import { type AppConfig, setting } from '../config/app-config.js';
import { startOfIstDay } from '../common/time.js';
import { RunOrchestratorService } from '../ingestion/run-orchestrator.service.js';

// The daily fetch at 06:00 IST, run inside the API server with @nestjs/schedule
// (docs/ARCHITECTURE.md §5). Safe with several API servers: the FetchRun lease lets only one
// run start. DISABLE_CRONS=true switches it off on a server (same flag name as mono-backend).

export const DAILY_FETCH_JOB = 'daily-fetch';
/** Seconds, minutes, hours: every day at 06:00:00. */
export const DAILY_FETCH_CRON = '0 0 6 * * *';
export const DAILY_FETCH_TIME_ZONE = 'Asia/Kolkata';
const RUN_HOUR_IST = 6;
const HOUR_MS = 3_600_000;

/** True when it's past today's 06:00 IST and no good run has started since then. */
export function catchUpDue(now: Date, lastGoodStart: Date | null): boolean {
  const todaysSlot = new Date(startOfIstDay(now).getTime() + RUN_HOUR_IST * HOUR_MS);
  if (now < todaysSlot) return false;
  return !lastGoodStart || lastGoodStart < todaysSlot;
}

@Injectable()
export class DailyFetchScheduler implements OnApplicationBootstrap {
  private readonly logger = new Logger(DailyFetchScheduler.name);
  private readonly enabled: boolean;

  constructor(
    private readonly orchestrator: RunOrchestratorService,
    private readonly prisma: PrismaService,
    config: ConfigService,
  ) {
    this.enabled = !setting(config as unknown as AppConfig, 'DISABLE_CRONS');
  }

  @Cron(DAILY_FETCH_CRON, { name: DAILY_FETCH_JOB, timeZone: DAILY_FETCH_TIME_ZONE })
  async daily(): Promise<void> {
    if (!this.enabled) return;
    await this.start('06:00 IST schedule');
  }

  /** If the server was down at 06:00, run once at start-up instead of waiting a whole day. */
  onApplicationBootstrap(): void {
    if (!this.enabled) {
      this.logger.log('daily fetch is off on this server (DISABLE_CRONS=true)');
      return;
    }
    this.logger.log('daily fetch scheduled for 06:00 IST');
    void this.catchUp(new Date());
  }

  /** Starts a run if today's 06:00 run is missing. Returns true when it started one. */
  async catchUp(now: Date): Promise<boolean> {
    let lastGoodStart: Date | null;
    try {
      const lastGood = await this.prisma.fetchRun.findFirst({
        where: { status: { in: ['SUCCESS', 'PARTIAL'] } },
        orderBy: { startedAt: 'desc' },
        select: { startedAt: true },
      });
      lastGoodStart = lastGood?.startedAt ?? null;
    } catch (err) {
      this.logger.warn(`catch-up check failed: ${(err as Error).message}`);
      return false;
    }
    if (!catchUpDue(now, lastGoodStart)) return false;
    await this.start('catch-up: no run yet today');
    return true;
  }

  private async start(reason: string): Promise<void> {
    this.logger.log(`daily fetch starting (${reason})`);
    try {
      const result = await this.orchestrator.run({ trigger: 'cron' });
      if (result.status === 'SKIPPED') this.logger.log('daily fetch skipped: another run is active');
    } catch (err) {
      // The orchestrator has already marked the run FAILED and sent the alert.
      this.logger.error(`daily fetch failed: ${(err as Error).message}`);
    }
  }
}
