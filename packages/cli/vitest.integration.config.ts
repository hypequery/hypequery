import { defineConfig } from 'vitest/config';
import baseConfig from './vitest.config';

export default defineConfig({
  ...baseConfig,
  test: {
    ...(baseConfig.test ?? {}),
    include: ['src/**/*.integration.test.ts'],
    exclude: [],
    testTimeout: 120_000,
    hookTimeout: 300_000,
  },
});
