import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { AppConfigModule } from './config/config.module.js';
import { PrismaModule } from './prisma/prisma.module.js';
import { HealthController } from './health/health.controller.js';
import { JobsModule } from './jobs/jobs.module.js';
import { ApiKeyGuard } from './common/guards/api-key.guard.js';
import { DailyFetchModule } from './schedule/daily-fetch.module.js';

// Root module for the API server. It also runs the daily fetch at 06:00 IST (DailyFetchModule).
// The manual script (scripts/fetch-jobs.ts) boots IngestionModule on its own.
@Module({
  imports: [AppConfigModule, PrismaModule, JobsModule, DailyFetchModule],
  controllers: [HealthController],
  providers: [{ provide: APP_GUARD, useClass: ApiKeyGuard }],
})
export class AppModule {}
