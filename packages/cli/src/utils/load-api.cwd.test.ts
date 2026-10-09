import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { access, mkdir, mkdtemp, readdir, realpath, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

// Real esbuild and filesystem: reproduces `hypequery mcp /abs/api.ts` launched
// from an unrelated directory, as desktop MCP clients do.
describe('loadApiModule from another working directory', () => {
  let project: string;
  let elsewhere: string;
  let cwdSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    vi.resetModules();
    project = await realpath(await mkdtemp(path.join(os.tmpdir(), 'hq-load-api-project-')));
    elsewhere = await realpath(await mkdtemp(path.join(os.tmpdir(), 'hq-load-api-cwd-')));

    await writeFile(path.join(project, 'package.json'), JSON.stringify({ name: 'app', type: 'module' }));
    const pkgDir = path.join(project, 'node_modules', 'hq-fake-serve');
    await mkdir(pkgDir, { recursive: true });
    await writeFile(
      path.join(pkgDir, 'package.json'),
      JSON.stringify({ name: 'hq-fake-serve', type: 'module', exports: './index.js' }),
    );
    await writeFile(path.join(pkgDir, 'index.js'), 'export const serve = () => ({ handler: () => "ok" });');

    await mkdir(path.join(project, 'analytics'));
    await writeFile(
      path.join(project, 'analytics', 'api.ts'),
      "import { serve } from 'hq-fake-serve';\nexport const api: { handler: () => string } = serve();\n",
    );

    cwdSpy = vi.spyOn(process, 'cwd').mockReturnValue(elsewhere);
  });

  afterEach(async () => {
    cwdSpy.mockRestore();
    await rm(project, { recursive: true, force: true });
    await rm(elsewhere, { recursive: true, force: true });
  });

  it("resolves bare imports from the entry's project, not the cwd", async () => {
    const { loadApiModule } = await import('./load-api.js');

    const api = await loadApiModule(path.join(project, 'analytics', 'api.ts'));

    expect(api.handler()).toBe('ok');
    expect(await readdir(path.join(project, '.hypequery', 'tmp'))).toHaveLength(1);
    await expect(access(path.join(elsewhere, '.hypequery'))).rejects.toThrow();
  });
});
