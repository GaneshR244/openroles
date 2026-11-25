import { z } from 'zod';

// Environment settings, validated once at boot (docs/ARCHITECTURE.md §3.14).
// A wrong or missing value stops the app with a clear message instead of failing later.

const COUNTRY_CODES = ['IN', 'AE', 'US'] as const;
export type TargetCountry = (typeof COUNTRY_CODES)[number];

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
  TARGET_COUNTRIES: z
    .string()
    .default('IN,AE,US')
    .transform((v) =>
      v
        .split(',')
        .map((c) => c.trim().toUpperCase())
        .filter(Boolean),
    )
    .pipe(z.array(z.enum(COUNTRY_CODES)).min(1)),
  MAX_JOB_AGE_DAYS: positiveInt(30),
  RETENTION_DAYS: positiveInt(90),
  RUN_DEADLINE_MINUTES: positiveInt(90),
  MAX_BOARDS_PER_RUN: positiveInt(5000),
  MAX_COMPANY_PROBES: positiveInt(100),
  LINKEDIN_ENABLED: bool,
  LINKEDIN_MAX_REQUESTS: positiveInt(300),
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
