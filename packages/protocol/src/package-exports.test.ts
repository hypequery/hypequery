import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

interface PackageJson {
  exports?: {
    '.'?: Record<string, string>;
  };
}

const packageJson = JSON.parse(
  readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
) as PackageJson;

describe('package exports', () => {
  it('provides a fallback for resolvers without the import condition', () => {
    const rootExport = packageJson.exports?.['.'];

    expect(rootExport?.default).toBe('./dist/index.js');
    expect(Object.keys(rootExport ?? {})).toEqual(['types', 'import', 'default']);
  });
});
