import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const readSource = (relative: string) =>
  readFileSync(path.join(packageRoot, 'src', relative), 'utf8');
const packageJson = JSON.parse(
  readFileSync(path.join(packageRoot, 'package.json'), 'utf8'),
) as {
  exports: Record<string, Record<string, unknown>>;
};

/** Matches `from './cli/…'` and `import('./cli/…')`, ignoring prose in comments. */
const CLI_IMPORT = /(?:from|import)\s*\(?\s*['"]\.\/cli\//;

describe('package entry points', () => {
  it('keeps the browser-safe root entry free of CLI imports', () => {
    // The CLI reaches for fs/promises, path, and dotenv. Anything imported here
    // ends up in client bundles, where those fail to resolve and break the build.
    expect(CLI_IMPORT.test(readSource('index.ts'))).toBe(false);
  });

  it('exposes generateTypes from the node entry', () => {
    const nodeEntry = readSource('index.node.ts');
    expect(nodeEntry).toContain("export * from './index.js'");
    expect(CLI_IMPORT.test(nodeEntry)).toBe(true);
    expect(nodeEntry).toContain('generateTypes');
  });

  it('maps the package root to the node entry only under the node condition', () => {
    const root = packageJson.exports['.'];

    expect(root.browser).toEqual({
      types: './dist/index.d.ts',
      default: './dist/index.js',
    });
    expect(root.node).toEqual({
      types: './dist/index.node.d.ts',
      import: './dist/index.node.js',
      require: './dist/index.node.js',
    });
    expect(root.default).toEqual({
      types: './dist/index.d.ts',
      default: './dist/index.js',
    });
  });

  it('keeps the dedicated cli subpath available', () => {
    expect(packageJson.exports['./cli']).toEqual({
      types: './dist/cli/index.d.ts',
      import: './dist/cli/index.js',
      require: './dist/cli/index.js',
    });
  });
});
