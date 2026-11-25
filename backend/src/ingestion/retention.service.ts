import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service.js';
import { type AppConfig, setting } from '../config/app-config.js';
import { daysBefore } from '../common/time.js';

// Deletes old data in small batches so no statement holds a long lock (docs/ARCHITECTURE.md §3.12).

const BATCH = 5000;
const RUN_HISTORY_DAYS = 180;

@Injectable()
export class RetentionService {
  private readonly config: AppConfig;

  constructor(
    private readonly prisma: PrismaService,
    config: ConfigService,
  ) {
    this.config = config as unknown as AppConfig;
  }

  async run(now: Date): Promise<{ deletedJobs: number; deletedRuns: number }> {
    const jobCutoff = daysBefore(now, setting(this.config, 'RETENTION_DAYS'));
    let deletedJobs = 0;
    for (;;) {
      const n = await this.prisma.$executeRaw`
        DELETE FROM "Job" WHERE "id" IN (
          SELECT "id" FROM "Job" WHERE "lastSeenAt" < ${jobCutoff} LIMIT ${BATCH}
        )`;
      deletedJobs += n;
      if (n < BATCH) break;
    }

    const runCutoff = daysBefore(now, RUN_HISTORY_DAYS);
    const runs = await this.prisma.fetchRun.deleteMany({
      where: { startedAt: { lt: runCutoff }, status: { not: 'RUNNING' } },
    });
    return { deletedJobs, deletedRuns: runs.count };
  }
}
