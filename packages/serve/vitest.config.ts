import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@hypequery/datasets/internal": new URL("../datasets/src/internal.ts", import.meta.url).pathname,
      "@hypequery/datasets": new URL("../datasets/src/index.ts", import.meta.url).pathname,
    },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
