// Runs before every e2e/integration test file: point the app at the test database.
try {
  process.loadEnvFile();
} catch {
  // CI provides the variables directly
}

const testUrl = process.env['DATABASE_URL_TEST'];
if (!testUrl) {
  throw new Error('DATABASE_URL_TEST is required for e2e and integration tests');
}
process.env['DATABASE_URL'] = testUrl;
process.env['API_KEY'] ??= 'test-api-key-0123456789abcdef';
// Tests that boot AppModule must never start a real fetch run.
process.env['DISABLE_CRONS'] = 'true';
