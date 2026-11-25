import { z } from 'zod';
import { JobSource } from '../generated/prisma/enums.js';

// Query parameters for the read API (docs/ARCHITECTURE.md §3.13). Shapes match frontend/lib/types.ts.

const emptyToUndefined = (v: unknown) => (v === '' ? undefined : v);

export const jobQuerySchema = z.object({
  view: z.enum(['new', 'week', 'all']).default('new'),
  country: z.preprocess(emptyToUndefined, z.enum(['IN', 'AE', 'US']).optional()),
  workMode: z.preprocess(emptyToUndefined, z.enum(['ONSITE', 'HYBRID', 'REMOTE']).optional()),
  source: z.preprocess(
    emptyToUndefined,
    z.enum(Object.values(JobSource) as [JobSource, ...JobSource[]]).optional(),
  ),
  q: z.preprocess(emptyToUndefined, z.string().trim().min(2).max(100).optional()),
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(50),
});

export type JobQuery = z.infer<typeof jobQuerySchema>;

export const companyIdSchema = z.string().min(1).max(40);
