import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { AppConfigModule } from './config/config.module.js';
import { PrismaModule } from './prisma/prisma.module.js';
import { HealthController } from './health/health.controller.js';
import { JobsModule } from './jobs/jobs.module.js';
import { ApiKeyGuard } from './common/guards/api-key.guard.js';

// Root module for the API server. The daily fetch script boots IngestionModule on its own.
@Module({
  imports: [AppConfigModule, PrismaModule, JobsModule],
  controllers: [HealthController],
  providers: [{ provide: APP_GUARD, useClass: ApiKeyGuard }],
})
export class AppModule {}
