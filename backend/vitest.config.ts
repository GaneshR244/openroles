import { defineConfig } from 'vitest/config';

// Unit tests: pure code next to the source as *.spec.ts. No database.
export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    globals: true,
    root: './',
    include: ['src/**/*.spec.ts'],
  },
});
