import { defineConfig } from 'vitest/config';
import baseConfig from './vitest.config.js';

/** Full package coverage includes the SQL paths that require a real ClickHouse. */
export default defineConfig({
  ...baseConfig,
  test: {
    ...baseConfig.test,
    include: ['src/**/*.test.ts'],
    exclude: [],
    testTimeout: 30_000,
    hookTimeout: 30_000,
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.test.ts', 'src/api.type-test.ts', 'src/tests/support/**'],
      reporter: ['text-summary', 'json', 'lcov'],
      reportsDirectory: 'coverage/full',
      thresholds: { statements: 95, branches: 90, functions: 97, lines: 95 },
    },
  },
});
