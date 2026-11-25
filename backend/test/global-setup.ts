import { execSync } from 'node:child_process';

// Once per e2e run: bring the test database schema up to date.
export default function setup(): void {
  try {
    process.loadEnvFile();
  } catch {
    // CI provides the variables directly
  }
  const testUrl = process.env['DATABASE_URL_TEST'];
  if (!testUrl) throw new Error('DATABASE_URL_TEST is required for e2e and integration tests');
  execSync('npx prisma migrate deploy', {
    stdio: 'ignore',
    env: { ...process.env, DATABASE_URL: testUrl },
  });
}
