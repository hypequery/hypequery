import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { disableJsonOutput, enableJsonOutput } from '../machine-output.js';
import { setUnattended } from '../input-mode.js';
import { exportTarget, loadOnboardEngine, ONBOARD_ENGINE_RANGE } from './engine-loader.js';
import { ONBOARD_ENGINE_SUBPATHS } from './engine-types.js';

vi.mock('../logger.js', () => ({ logger: { warn: vi.fn(), info: vi.fn(), success: vi.fn() } }));

const temporary: string[] = [];
async function directory(withPackageJson = true): Promise<string> {
  const created = await realpath(await mkdtemp(path.join(tmpdir(), 'hq-engine-')));
  temporary.push(created);
  if (withPackageJson) await writeFile(path.join(created, 'package.json'), '{"name":"app","private":true}');
  return created;
}
afterEach(async () => {
  disableJsonOutput();
  setUnattended(false, {});
  await Promise.all(temporary.splice(0).map(item => rm(item, { recursive: true, force: true })));
});

/** A fake engine package: every subpath module exports where it was loaded from. */
async function installFakeEngine(root: string, version: string) {
  const directory = path.join(root, 'node_modules', '@hypequery', 'onboard-engine');
  await mkdir(path.join(directory, 'dist'), { recursive: true });
  await writeFile(path.join(directory, 'package.json'), JSON.stringify({
    name: '@hypequery/onboard-engine',
    version,
    type: 'module',
    exports: { './*': { types: './dist/*.d.ts', import: './dist/*.js' }, './package.json': './package.json' },
  }));
  for (const subpath of ONBOARD_ENGINE_SUBPATHS) {
    await writeFile(path.join(directory, 'dist', `${subpath}.js`), `export const loadedFrom = ${JSON.stringify(`${version}:${subpath}`)};\n`);
  }
  return directory;
}

const interactive = { stdin: { isTTY: true }, installCommand: async () => ['npm', 'install', '-D', `@hypequery/onboard-engine@${ONBOARD_ENGINE_RANGE}`] };

describe('loadOnboardEngine', () => {
  it('loads every module from the project, within the range', async () => {
    const cwd = await directory();
    const installed = await installFakeEngine(cwd, '0.1.3');
    const engine = await loadOnboardEngine('onboard analyze', { cwd, cliDirectory: await directory(false) });
    expect(engine).toMatchObject({ version: '0.1.3', from: 'project', directory: installed });
    expect((engine.modules.introspection as unknown as { loadedFrom: string }).loadedFrom).toBe('0.1.3:introspection');
    expect(Object.keys(engine.modules).sort()).toEqual([...ONBOARD_ENGINE_SUBPATHS].sort());
  });

  it('falls back to a copy beside the CLI (npx -p) when the project has none', async () => {
    const cwd = await directory();
    const cli = await directory(false);
    await installFakeEngine(cli, '0.1.0');
    expect(await loadOnboardEngine('schema inspect', { cwd, cliDirectory: cli })).toMatchObject({ from: 'cli', version: '0.1.0' });
  });

  it('prefers a compatible CLI copy over an out-of-range project copy', async () => {
    const cwd = await directory();
    await installFakeEngine(cwd, '0.2.0');
    const cli = await directory(false);
    await installFakeEngine(cli, '0.1.1');
    expect(await loadOnboardEngine('onboard check', { cwd, cliDirectory: cli })).toMatchObject({ from: 'cli', version: '0.1.1' });
  });

  it('fails with ONBOARD_ENGINE_MISSING under --json, naming the install command, without prompting', async () => {
    enableJsonOutput(() => undefined);
    const cwd = await directory();
    const confirm = vi.fn();
    const error = await loadOnboardEngine('onboard analyze', { cwd, cliDirectory: await directory(false), ...interactive, confirm }).catch(caught => caught);
    expect(error).toMatchObject({ code: 'ONBOARD_ENGINE_MISSING', exitClass: 'correctable', telemetryCode: 'not_installed' });
    expect(error.hint).toContain(`npm install -D @hypequery/onboard-engine@${ONBOARD_ENGINE_RANGE}`);
    expect(error.hint).toContain('npx -p @hypequery/cli -p @hypequery/onboard-engine');
    expect(confirm).not.toHaveBeenCalled();
  });

  it('fails without a TTY or with --no-input', async () => {
    const cwd = await directory();
    const cliDirectory = await directory(false);
    await expect(loadOnboardEngine('onboard analyze', { cwd, cliDirectory, stdin: { isTTY: false } }))
      .rejects.toMatchObject({ code: 'ONBOARD_ENGINE_MISSING' });
    setUnattended(true, {});
    const confirm = vi.fn();
    await expect(loadOnboardEngine('onboard analyze', { cwd, cliDirectory, ...interactive, confirm }))
      .rejects.toMatchObject({ code: 'ONBOARD_ENGINE_MISSING' });
    expect(confirm).not.toHaveBeenCalled();
  });

  it('reports an out-of-range version as ONBOARD_ENGINE_INCOMPATIBLE', async () => {
    const cwd = await directory();
    await installFakeEngine(cwd, '0.2.0');
    await expect(loadOnboardEngine('onboard analyze', { cwd, cliDirectory: await directory(false), stdin: { isTTY: false } }))
      .rejects.toMatchObject({ code: 'ONBOARD_ENGINE_INCOMPATIBLE', message: expect.stringContaining('0.2.0 is installed') });
  });

  it('offers to install at a terminal, then loads what was installed', async () => {
    const cwd = await directory();
    const confirm = vi.fn(async () => true);
    const install = vi.fn(async (_specifier: string, into: string) => {
      await installFakeEngine(into, '0.1.0');
      return true;
    });
    const engine = await loadOnboardEngine('onboard analyze', { cwd, cliDirectory: await directory(false), ...interactive, confirm, install });
    expect(confirm).toHaveBeenCalledWith(`npm install -D @hypequery/onboard-engine@${ONBOARD_ENGINE_RANGE}`);
    expect(install).toHaveBeenCalledWith(`@hypequery/onboard-engine@${ONBOARD_ENGINE_RANGE}`, cwd);
    expect(engine).toMatchObject({ from: 'project', version: '0.1.0' });
  });

  it('still fails with the install command when the offer is declined, or outside a Node project', async () => {
    const cwd = await directory();
    const install = vi.fn();
    await expect(loadOnboardEngine('onboard analyze', { cwd, cliDirectory: await directory(false), ...interactive, confirm: async () => false, install }))
      .rejects.toMatchObject({ code: 'ONBOARD_ENGINE_MISSING' });
    expect(install).not.toHaveBeenCalled();
    const python = await directory(false);
    const confirm = vi.fn();
    await expect(loadOnboardEngine('onboard analyze', { cwd: python, cliDirectory: await directory(false), ...interactive, confirm }))
      .rejects.toMatchObject({ code: 'ONBOARD_ENGINE_MISSING' });
    expect(confirm).not.toHaveBeenCalled();
  });

  it('refuses an engine that lacks a module the CLI needs', async () => {
    const cwd = await directory();
    const installed = await installFakeEngine(cwd, '0.1.0');
    await writeFile(path.join(installed, 'package.json'), JSON.stringify({ name: '@hypequery/onboard-engine', version: '0.1.0', exports: { './introspection': './dist/introspection.js', './package.json': './package.json' } }));
    await expect(loadOnboardEngine('onboard analyze', { cwd, cliDirectory: await directory(false) }))
      .rejects.toMatchObject({ code: 'ONBOARD_ENGINE_INCOMPATIBLE' });
  });
});

describe('exportTarget', () => {
  it('follows exact and pattern exports for import', () => {
    const map = { './a': { import: './x/a.mjs' }, './*': { types: './d/*.d.ts', import: './d/*.js' }, './raw/*.json': './raw/*.json' };
    expect(exportTarget(map, 'a')).toBe('./x/a.mjs');
    expect(exportTarget(map, 'introspection')).toBe('./d/introspection.js');
    expect(exportTarget(undefined, 'a')).toBeUndefined();
    expect(exportTarget({ './*': { require: './c/*.cjs' } }, 'a')).toBeUndefined();
  });
});
