import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { findProjectRoot, importFromProject } from './project-root.js';

describe('project-root', () => {
  let root: string;

  beforeEach(async () => {
    root = await realpath(await mkdtemp(path.join(os.tmpdir(), 'hq-project-root-')));
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  describe('findProjectRoot', () => {
    it('returns the nearest ancestor with a package.json', async () => {
      await writeFile(path.join(root, 'package.json'), '{}');
      await mkdir(path.join(root, 'analytics', 'nested'), { recursive: true });

      await expect(findProjectRoot(path.join(root, 'analytics', 'nested', 'api.ts'))).resolves.toBe(root);
    });

    it("falls back to the file's directory without a package.json", async () => {
      const dir = path.join(root, 'loose');
      await mkdir(dir);

      // os.tmpdir() has no package.json above it on supported platforms.
      await expect(findProjectRoot(path.join(dir, 'api.ts'))).resolves.toBe(dir);
    });
  });

  describe('importFromProject', () => {
    it("imports the package installed beside the file", async () => {
      const pkgDir = path.join(root, 'node_modules', 'hq-fake-pkg');
      await mkdir(pkgDir, { recursive: true });
      await writeFile(path.join(pkgDir, 'package.json'), JSON.stringify({ name: 'hq-fake-pkg', main: 'index.cjs' }));
      await writeFile(path.join(pkgDir, 'index.cjs'), 'module.exports = { from: "project" };');

      const mod = await importFromProject<{ default: { from: string } }>(
        'hq-fake-pkg',
        path.join(root, 'api.ts'),
        async () => ({ default: { from: 'fallback' } }),
      );

      expect(mod.default.from).toBe('project');
    });

    it('uses the fallback when the project lacks the package', async () => {
      const mod = await importFromProject('hq-missing-pkg', path.join(root, 'api.ts'), async () => 'fallback');

      expect(mod).toBe('fallback');
    });
  });
});
