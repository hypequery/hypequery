import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';

describe('package exports', () => {
  it('resolves and loads the package under require conditions', () => {
    const fixtureRoot = mkdtempSync(path.join(tmpdir(), 'hypequery-protocol-exports-'));

    try {
      const packageRoot = path.join(
        fixtureRoot,
        'node_modules',
        '@hypequery',
        'protocol',
      );
      const distRoot = path.join(packageRoot, 'dist');
      const entryPath = path.join(distRoot, 'index.js');
      mkdirSync(distRoot, { recursive: true });
      writeFileSync(
        path.join(packageRoot, 'package.json'),
        readFileSync(new URL('../package.json', import.meta.url)),
      );
      writeFileSync(entryPath, 'export const exportConditionProbe = true;\n');

      const require = createRequire(
        pathToFileURL(path.join(fixtureRoot, 'consumer.cjs')),
      );
      const resolvedPath = require.resolve('@hypequery/protocol');
      const protocol = require('@hypequery/protocol') as Record<string, unknown>;

      expect(resolvedPath).toBe(realpathSync(entryPath));
      expect(protocol.exportConditionProbe).toBe(true);
    } finally {
      rmSync(fixtureRoot, { recursive: true, force: true });
    }
  });
});
