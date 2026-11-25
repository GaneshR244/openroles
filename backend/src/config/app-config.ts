import { ConfigService } from '@nestjs/config';
import type { Env } from './env.js';

// Typed access to validated settings: config.get('MAX_JOB_AGE_DAYS') returns a number.
export type AppConfig = ConfigService<Env, true>;

export function setting<K extends keyof Env>(config: AppConfig, key: K): Env[K] {
  return config.get(key, { infer: true });
}
