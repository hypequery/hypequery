import { mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanupLoadedApiArtifacts, loadApiModule } from './load-api.js';

describe('loaded API artifact cleanup', () => {
  let project: string;
  beforeEach(async () => {
    project = await mkdtemp(path.join(tmpdir(), 'hq-load-api-cleanup-'));
    vi.spyOn(process, 'cwd').mockReturnValue(project);
  });
  afterEach(async () => {
    vi.restoreAllMocks();
    await rm(project, { recursive: true, force: true });
  });

  it("removes this process's bundles but keeps another process's in the shared root", async () => {
    // Bundling a TypeScript entry creates a bundle directory this process owns.
    await writeFile(path.join(project, 'api.ts'), 'export const api = { queries: {} };\n');
    await loadApiModule('api.ts').catch(() => undefined);
    const root = path.join(project, '.hypequery', 'tmp');
    const owned = await readdir(root);
    expect(owned.length).toBeGreaterThan(0);
    // For example a concurrent `dev` session reloading from its bundle directory.
    const other = path.join(root, 'bundle-other-process');
    await mkdir(other);
    await writeFile(path.join(other, 'api.mjs'), 'export {};');
    await cleanupLoadedApiArtifacts();
    expect(await readdir(root)).toEqual(['bundle-other-process']);
    expect(await readdir(other)).toEqual(['api.mjs']);
  });

  it('leaves the shared temp root alone when this process created no bundles', async () => {
    await mkdir(path.join(project, '.hypequery', 'tmp'), { recursive: true });
    await cleanupLoadedApiArtifacts();
    expect(await readdir(path.join(project, '.hypequery'))).toEqual(['tmp']);
  });
});
