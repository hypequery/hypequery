import { defineConfig, mergeConfig } from 'vitest/config';
import baseConfig from './vitest.config';

export default mergeConfig(baseConfig, defineConfig({
  test: {
    include: ['src/core/tests/integration/**/*.test.ts'],
    exclude: [],
    globals: true,
    environment: 'node',
    threads: false,
    testTimeout: 30_000,
    hookTimeout: 30_000
  }
}));
