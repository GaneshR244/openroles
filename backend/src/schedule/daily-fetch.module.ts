import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { IngestionModule } from '../ingestion/ingestion.module.js';
import { DailyFetchScheduler } from './daily-fetch.scheduler.js';

// Runs the morning fetch from the API server at 06:00 IST (see daily-fetch.scheduler.ts).
@Module({
  imports: [ScheduleModule.forRoot(), IngestionModule],
  providers: [DailyFetchScheduler],
})
export class DailyFetchModule {}
