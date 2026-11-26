import { z } from 'zod';

// Environment settings, validated once at boot (docs/ARCHITECTURE.md §3.14).
// A wrong or missing value stops the app with a clear message instead of failing later.

const bool = z
  .enum(['true', 'false', '1', '0', ''])
  .default('false')
  .transform((v) => v === 'true' || v === '1');

const positiveInt = (fallback: number) => z.coerce.number().int().positive().default(fallback);

export const envSchema = z.object({
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  PORT: positiveInt(4000),
  API_KEY: z.string().min(16, 'API_KEY must be at least 16 characters'),
  FRONTEND_ORIGIN: z.string().default('http://localhost:3000'),
  /** ISO codes to keep, e.g. "IN,AE,US". "ALL" or empty keeps every country (the default). */
  TARGET_COUNTRIES: z
    .string()
    .default('ALL')
    .transform((v) =>
      v.trim().toUpperCase() === 'ALL'
        ? []
        : v
            .split(',')
            .map((c) => c.trim().toUpperCase())
            .filter(Boolean),
    )
    .pipe(z.array(z.string().regex(/^[A-Z]{2}$/, 'use two-letter ISO country codes'))),
  MAX_JOB_AGE_DAYS: positiveInt(30),
  RETENTION_DAYS: positiveInt(90),
  RUN_DEADLINE_MINUTES: positiveInt(90),
  MAX_BOARDS_PER_RUN: positiveInt(20000),
  MAX_COMPANY_PROBES: positiveInt(100),
  LINKEDIN_ENABLED: bool,
  LINKEDIN_MAX_REQUESTS: positiveInt(300),
  /** Who reads LinkedIn: "apify" (curious_coder/linkedin-jobs-scraper, paid per job) or "guest" (our own logged-out reader). */
  LINKEDIN_PROVIDER: z.enum(['guest', 'apify']).default('guest'),
  APIFY_TOKEN: z
    .string()
    .optional()
    .transform((v) => (v ? v : undefined)),
  /** Most LinkedIn jobs taken from Apify per IST day, across all runs (each job costs money). */
  APIFY_LINKEDIN_DAILY_LIMIT: positiveInt(50),
  /** Hard spending cap for one Apify run, in US dollars. */
  APIFY_MAX_COST_USD: z.coerce.number().positive().default(0.15),
  /** true switches off the 06:00 IST fetch inside this API server (same name as mono-backend). */
  DISABLE_CRONS: bool,
  SLACK_WEBHOOK_URL: z
    .string()
    .optional()
    .transform((v) => (v ? v : undefined)),
});

export type Env = z.infer<typeof envSchema>;

export function validateEnv(raw: Record<string, unknown>): Env {
  const result = envSchema.safeParse(raw);
  if (!result.success) {
    const problems = result.error.issues
      .map((i) => `  - ${i.path.join('.')}: ${i.message}`)
      .join('\n');
    throw new Error(`Invalid environment settings:\n${problems}`);
  }
  return result.data;
}
