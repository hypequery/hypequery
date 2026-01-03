import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { PluginOption } from 'vitest/config';
import { defineConfig } from 'vitest/config';

function normalizeImporter(importer: string): string {
  if (importer.startsWith('file://')) {
    return fileURLToPath(importer);
  }

  return importer;
}

function resolveJsExtensions(): PluginOption {
  return {
    name: 'resolve-js-extensions',
    enforce: 'pre',
    resolveId(source, importer) {
      if (!importer) {
        return null;
      }

      if (!source.startsWith('.') && !source.startsWith('/')) {
        return null;
      }

      if (!source.endsWith('.js')) {
        return null;
      }

      const importerPath = normalizeImporter(importer);
      const resolvedPath = source.startsWith('/')
        ? source
        : path.resolve(path.dirname(importerPath), source);

      const tsCandidate = resolvedPath.replace(/\.js$/, '.ts');
      if (existsSync(tsCandidate)) {
        return tsCandidate;
      }

      const tsxCandidate = resolvedPath.replace(/\.js$/, '.tsx');
      if (existsSync(tsxCandidate)) {
        return tsxCandidate;
      }

      return null;
    }
  };
}

export default defineConfig({
  plugins: [resolveJsExtensions()],
  test: {
    include: ['src/**/*.test.ts'],
    exclude: ['src/core/tests/integration/**/*.test.ts'],
    environment: 'node',
    globals: true,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov']
    }
  }
});
