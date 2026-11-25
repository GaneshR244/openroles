import { Module } from '@nestjs/common';
import { AppConfigModule } from '../config/config.module.js';
import { PrismaModule } from '../prisma/prisma.module.js';
import { HttpClient } from '../common/http/http-client.js';
import { GreenhouseReader } from './sources/greenhouse.reader.js';
import { LeverReader } from './sources/lever.reader.js';
import { AshbyReader } from './sources/ashby.reader.js';
import { SmartRecruitersReader } from './sources/smartrecruiters.reader.js';
import { WorkableReader } from './sources/workable.reader.js';
import { BoardReaders } from './sources/board-readers.js';
import { JobStoreService } from './job-store.service.js';
import { BoardLaneService } from './board-lane.service.js';
import { BoardFinderService } from './board-finder.service.js';
import { LinkedInLaneService } from './linkedin-lane.service.js';
import { RetentionService } from './retention.service.js';
import { ReporterService } from './reporter.service.js';
import { RunOrchestratorService } from './run-orchestrator.service.js';
import { YcImportService } from './yc-import.service.js';

// Everything the daily fetch script needs. Booted on its own by scripts/fetch-jobs.ts,
// never by the API server.
@Module({
  imports: [AppConfigModule, PrismaModule],
  providers: [
    HttpClient,
    GreenhouseReader,
    LeverReader,
    AshbyReader,
    SmartRecruitersReader,
    WorkableReader,
    BoardReaders,
    JobStoreService,
    BoardLaneService,
    BoardFinderService,
    LinkedInLaneService,
    RetentionService,
    ReporterService,
    RunOrchestratorService,
    YcImportService,
  ],
  exports: [RunOrchestratorService, YcImportService, BoardFinderService],
})
export class IngestionModule {}
