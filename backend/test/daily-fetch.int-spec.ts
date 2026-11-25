import { Test, type TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { ScheduleModule, SchedulerRegistry } from '@nestjs/schedule';
import { AppConfigModule } from '../src/config/config.module.js';
import { PrismaModule } from '../src/prisma/prisma.module.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { RunOrchestratorService } from '../src/ingestion/run-orchestrator.service.js';
import {
  DAILY_FETCH_JOB,
  DailyFetchScheduler,
} from '../src/schedule/daily-fetch.scheduler.js';
import { resetDb } from './helpers/db.js';

// 09:00 UTC on 25 Nov 2026 is 14:30 IST, after the 06:00 IST slot.
const AFTERNOON = new Date('2026-11-25T09:00:00Z');

function fakeOrchestrator(run: () => Promise<unknown> = async () => ({ status: 'SUCCESS' })) {
  return { run: vi.fn(run) };
}

/** ConfigService stand-in: only DISABLE_CRONS is read by the scheduler. */
const config = (disabled: boolean) =>
  ({ get: (key: string) => (key === 'DISABLE_CRONS' ? disabled : undefined) }) as ConfigService;

describe('DailyFetchScheduler (integration, real PostgreSQL)', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  const orchestrator = fakeOrchestrator();

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [ScheduleModule.forRoot(), AppConfigModule, PrismaModule],
      providers: [DailyFetchScheduler, { provide: RunOrchestratorService, useValue: orchestrator }],
    }).compile();
    await moduleRef.init();
    prisma = moduleRef.get(PrismaService);
  });

  afterAll(async () => {
    await moduleRef.close();
  });

  beforeEach(async () => {
    await resetDb(prisma);
  });

  it('registers one job for 06:00 India time every day', () => {
    const job = moduleRef.get(SchedulerRegistry).getCronJob(DAILY_FETCH_JOB);
    const next = job.nextDate().setZone('Asia/Kolkata');
    expect([next.hour, next.minute, next.second]).toEqual([6, 0, 0]);
  });

  it('does not start a run at boot while DISABLE_CRONS=true (the test setting)', () => {
    expect(orchestrator.run).not.toHaveBeenCalled();
  });

  it("starts a catch-up run when today's 06:00 run is missing", async () => {
    const fake = fakeOrchestrator();
    const scheduler = new DailyFetchScheduler(fake as never, prisma, config(false));
    await prisma.fetchRun.create({
      data: { status: 'SUCCESS', startedAt: new Date('2026-11-24T00:30:00Z') },
    });

    expect(await scheduler.catchUp(AFTERNOON)).toBe(true);
    expect(fake.run).toHaveBeenCalledExactlyOnceWith({ trigger: 'cron' });
  });

  it('does nothing when a good run already happened today', async () => {
    const fake = fakeOrchestrator();
    const scheduler = new DailyFetchScheduler(fake as never, prisma, config(false));
    await prisma.fetchRun.create({
      data: { status: 'PARTIAL', startedAt: new Date('2026-11-25T00:30:00Z') },
    });

    expect(await scheduler.catchUp(AFTERNOON)).toBe(false);
    expect(fake.run).not.toHaveBeenCalled();
  });

  it('keeps the API alive when a run fails', async () => {
    const fake = fakeOrchestrator(async () => {
      throw new Error('database went away');
    });
    const scheduler = new DailyFetchScheduler(fake as never, prisma, config(false));

    await expect(scheduler.catchUp(AFTERNOON)).resolves.toBe(true);
  });

  it('skips the 06:00 tick on a server with DISABLE_CRONS=true', async () => {
    const fake = fakeOrchestrator();
    const scheduler = new DailyFetchScheduler(fake as never, prisma, config(true));

    await scheduler.daily();
    expect(fake.run).not.toHaveBeenCalled();
  });

  it('runs the 06:00 tick when crons are on', async () => {
    const fake = fakeOrchestrator();
    const scheduler = new DailyFetchScheduler(fake as never, prisma, config(false));

    await scheduler.daily();
    expect(fake.run).toHaveBeenCalledExactlyOnceWith({ trigger: 'cron' });
  });
});
