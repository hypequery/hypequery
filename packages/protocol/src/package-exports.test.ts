import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);

describe('package exports', () => {
  it('resolves and loads the package under require conditions', () => {
    const entryPath = require.resolve('@hypequery/protocol');
    const protocol = require('@hypequery/protocol') as Record<string, unknown>;

    expect(entryPath).toBe(fileURLToPath(new URL('../dist/index.js', import.meta.url)));
    expect(protocol.validateCanonicalValue).toBeTypeOf('function');
  });
});
