import { validateEnv } from './env.js';

const base = {
  DATABASE_URL: 'postgresql://u:p@localhost:5432/db',
  API_KEY: 'a'.repeat(32),
};

describe('validateEnv', () => {
  it('applies defaults', () => {
    const env = validateEnv(base);
    expect(env.PORT).toBe(4000);
    expect(env.TARGET_COUNTRIES).toEqual(['IN', 'AE', 'US']);
    expect(env.MAX_JOB_AGE_DAYS).toBe(30);
    expect(env.LINKEDIN_ENABLED).toBe(false);
    expect(env.SLACK_WEBHOOK_URL).toBeUndefined();
  });

  it('parses country lists and booleans', () => {
    const env = validateEnv({ ...base, TARGET_COUNTRIES: ' in, us ', LINKEDIN_ENABLED: 'true' });
    expect(env.TARGET_COUNTRIES).toEqual(['IN', 'US']);
    expect(env.LINKEDIN_ENABLED).toBe(true);
  });

  it('rejects an unknown country', () => {
    expect(() => validateEnv({ ...base, TARGET_COUNTRIES: 'IN,FR' })).toThrow(/TARGET_COUNTRIES/);
  });

  it('rejects a missing database url and a short api key', () => {
    expect(() => validateEnv({ API_KEY: 'short' })).toThrow(/DATABASE_URL[\s\S]*API_KEY/);
  });
});
