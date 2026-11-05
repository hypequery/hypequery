import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { MCP_PACKAGE_VERSION } from './version.js';

const packageRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

function read(relative: string): string {
  return readFileSync(path.join(packageRoot, relative), 'utf8');
}

describe('package version', () => {
  it('matches the manifest a release bumps', () => {
    // `prebuild` regenerates the constant, and `test` depends on `build`, so a
    // mismatch here means generation was skipped rather than that it drifted.
    const { version } = JSON.parse(read('package.json')) as { version: string };
    expect(MCP_PACKAGE_VERSION).toBe(version);
    expect(MCP_PACKAGE_VERSION).not.toBe('');
  });

  it('is the version server.json tells the MCP Registry to verify', () => {
    // The registry fetches the npm release named in server.json and requires
    // `mcpName` in that release's manifest, so a stale version there fails
    // every publish. generate-version.mjs rewrites both fields from package.json.
    const manifest = JSON.parse(read('package.json')) as { version: string; mcpName: string };
    const registry = JSON.parse(read('server.json')) as {
      name: string;
      version: string;
      packages: { identifier: string; version: string }[];
    };
    expect(registry.version).toBe(manifest.version);
    expect(registry.packages.map(entry => entry.version)).toEqual(
      registry.packages.map(() => manifest.version),
    );
    expect(registry.name).toBe(manifest.mcpName);
    expect(registry.packages.map(entry => entry.identifier)).toEqual(['@hypequery/mcp']);
  });

  it('is resolved without reading anything at import time', () => {
    // Reading package.json off `import.meta.url` made this package impossible
    // to import from a bundled server build: webpack rewrites that URL, and
    // Node's fs rejects the resulting cross-realm URL with ERR_INVALID_ARG_TYPE.
    // Importing @hypequery/mcp must not touch the filesystem at all.
    const source = read('src/version.ts');
    expect(source).not.toMatch(/node:fs|import\.meta\.url|require\(/);
    expect(source).toContain(`'${MCP_PACKAGE_VERSION}'`);
  });
});
