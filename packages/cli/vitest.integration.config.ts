import { defineConfig } from 'vitest/config';
import baseConfig from './vitest.config';

export default defineConfig({
  ...baseConfig,
  test: {
    ...(baseConfig.test ?? {}),
    include: ['src/**/*.integration.test.ts'],
    exclude: [],
    threads: false,
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
