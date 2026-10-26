import { defineConfig } from 'vitest/config';

// Needs a live Postgres: set POSTGRES_URL (e.g. postgres://localhost:55432/postgres).
export default defineConfig({
  test: {
    include: ['src/tests/integration/**/*.test.ts'],
    environment: 'node',
    fileParallelism: false,
    testTimeout: 30_000,
  },
});
