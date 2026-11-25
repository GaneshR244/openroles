import { Test } from '@nestjs/testing';
import { createHash } from 'node:crypto';
import { AppConfigModule } from '../../src/config/config.module.js';
import { PrismaModule } from '../../src/prisma/prisma.module.js';
import { PrismaService } from '../../src/prisma/prisma.service.js';
import type { NormalizedJob, PreparedBatch } from '../../src/ingestion/pipeline/pipeline.types.js';

/** Builds a Nest testing module with config + Prisma (test database) and the given providers. */
export async function createTestingApp(providers: any[]) {
  const moduleRef = await Test.createTestingModule({
    imports: [AppConfigModule, PrismaModule],
    providers,
  }).compile();
  await moduleRef.init();
  return moduleRef;
}

/** Empties every table between tests. */
export async function resetDb(prisma: PrismaService): Promise<void> {
  await prisma.$executeRawUnsafe(
    'TRUNCATE TABLE "Job", "Board", "Company", "FetchRun" RESTART IDENTITY CASCADE',
  );
}

const sha1 = (s: string) => createHash('sha1').update(s).digest('hex');

/** A cleaned job with sensible defaults; the fingerprint follows company|title|location. */
export function job(overrides: Partial<NormalizedJob> & { externalId: string }): NormalizedJob {
  const base: NormalizedJob = {
    source: 'GREENHOUSE',
    externalId: overrides.externalId,
    title: `Role ${overrides.externalId}`,
    companyName: 'Acme Payments',
    normalizedCompany: 'acme payments',
    location: 'Bengaluru, India',
    country: 'IN',
    workMode: 'UNKNOWN',
    url: `https://example.com/jobs/${overrides.externalId}`,
    postedAt: new Date('2026-11-20T00:00:00Z'),
    fingerprint: '',
  };
  const merged = { ...base, ...overrides };
  merged.fingerprint ||= sha1(`${merged.normalizedCompany}|${merged.title}|${merged.location}`);
  return merged;
}

/** Wraps jobs as a prepared batch where everything fetched was kept. */
export function batchOf(jobs: NormalizedJob[], extraSeen: NormalizedJob[] = []): PreparedBatch {
  return {
    seen: [...jobs, ...extraSeen].map((j) => ({
      externalId: j.externalId,
      fingerprint: j.fingerprint,
    })),
    kept: jobs,
    dropped: {
      missing_fields: 0,
      too_old: 0,
      outside_markets: 0,
      remote_without_market: 0,
      blocklisted: 0,
      duplicate_in_batch: 0,
    },
  };
}
