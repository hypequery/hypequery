import { defineConfig } from "vitest/config";
import baseConfig from "./vitest.config";

export default defineConfig({
  ...baseConfig,
  test: {
    ...(baseConfig.test ?? {}),
    include: ["src/**/*.integration.spec.ts"],
    exclude: [],
    threads: false,
    testTimeout: 30_000,
    hookTimeout: 90_000,
  },
});
