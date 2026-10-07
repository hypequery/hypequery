import { chmod, mkdtemp, readFile, readdir, rm, stat, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { TelemetryConfigStore } from './config-store.js';
import { resolveTelemetryState, telemetryOptOutSource } from './opt-out.js';

describe('telemetry preferences', () => {
  let directory: string;
  let store: TelemetryConfigStore;
  beforeEach(async () => {
    directory = await mkdtemp(path.join(tmpdir(), 'hypequery-telemetry-'));
    store = new TelemetryConfigStore({ configDirectory: directory, env: {} });
  });
  afterEach(async () => { await rm(directory, { recursive: true, force: true }); });

  it('creates and preserves a random identity with private file permissions', async () => {
    expect(await store.peek()).toBeNull();
    const config = await store.load();
    expect(config).toMatchObject({ schema_version: 1, enabled: true });
    expect(config?.install_id).toMatch(/^[0-9a-f-]{36}$/);
    expect(await store.load()).toEqual(config);
    if (process.platform !== 'win32') {
      expect((await stat(path.join(directory, 'telemetry.json'))).mode & 0o777).toBe(0o600);
    }
    expect(await readdir(directory)).toEqual(['telemetry.json']);
  });

  it('preserves identity and notice while changing consent', async () => {
    const config = await store.load();
    await writeFile(path.join(directory, 'telemetry.json'), JSON.stringify({
      ...config, notice_shown_at: '2026-10-05T10:00:00.000Z',
    }));
    expect(await store.setEnabled(false)).toEqual({
      ...config, enabled: false, notice_shown_at: '2026-10-05T10:00:00.000Z',
    });
    expect(await store.setEnabled(true)).toMatchObject({ install_id: config?.install_id, enabled: true });
  });

  it('serializes concurrent creation so every caller gets the same identity', async () => {
    const configs = await Promise.all(Array.from({ length: 8 }, () => store.load()));
    expect(configs.every(config => config !== null)).toBe(true);
    expect(new Set(configs.map(config => config?.install_id)).size).toBe(1);
    expect(JSON.parse(await readFile(path.join(directory, 'telemetry.json'), 'utf8'))).toEqual(configs[0]);
    expect(await readdir(directory)).toEqual(['telemetry.json']);
  });

  it.each(['{', '[]', '{}', '{"enabled":true}', '{"schema_version":2}'])('fails closed on corrupt settings: %s', async input => {
    await writeFile(path.join(directory, 'telemetry.json'), input);
    expect(await resolveTelemetryState({ configDirectory: directory, env: {} })).toMatchObject({
      enabled: false, source: 'config_unavailable',
    });
    expect(await readFile(path.join(directory, 'telemetry.json'), 'utf8')).toBe(input);
    // An explicit opt-out repairs broken settings and remains persisted.
    expect(await store.setEnabled(false)).toMatchObject({ enabled: false });
    expect(await store.load()).toMatchObject({ enabled: false });
  });

  it('fails closed with missing home, invalid directory or unavailable settings', async () => {
    expect(await new TelemetryConfigStore({ env: {}, platform: 'linux' }).load()).toBeNull();
    expect(await new TelemetryConfigStore({ env: { HOME: path.join(directory, 'missing') }, platform: 'linux' }).load()).toBeNull();
    const file = path.join(directory, 'file');
    await writeFile(file, 'not a directory');
    expect(await new TelemetryConfigStore({ configDirectory: file }).load()).toBeNull();
    await mkdir(path.join(directory, 'telemetry.json'));
    expect(await store.load()).toBeNull();
  });

  it('fails closed on a stale lock and leaves it alone', async () => {
    await mkdir(path.join(directory, 'telemetry.lock'));
    expect(await store.load()).toBeNull();
    expect(await readdir(directory)).toEqual(['telemetry.lock']);
  });

  it.skipIf(process.platform === 'win32' || process.getuid?.() === 0)('fails closed in a read-only config directory', async () => {
    await store.load();
    await chmod(directory, 0o500);
    try {
      expect(await store.load()).toBeNull();
      expect(await store.setEnabled(false)).toBeNull();
    } finally {
      await chmod(directory, 0o700);
    }
  });

  it.each([
    [{ telemetry: false, env: { DO_NOT_TRACK: '1' } }, 'flag'],
    [{ env: { DO_NOT_TRACK: '1', HYPEQUERY_TELEMETRY_DISABLED: '1' } }, 'DO_NOT_TRACK'],
    [{ env: { HYPEQUERY_TELEMETRY_DISABLED: '1', NODE_ENV: 'test' } }, 'HYPEQUERY_TELEMETRY_DISABLED'],
    [{ env: { VITEST: 'true' } }, 'test'],
    [{ env: { NODE_ENV: 'test' } }, 'test'],
    [{ env: { GITHUB_ACTIONS: 'true', GITHUB_REPOSITORY: 'hypequery/hypequery' } }, 'hypequery_ci'],
  ])('respects precedence and creates no settings for opt-out: %j', async (options, source) => {
    expect(telemetryOptOutSource(options)).toBe(source);
    expect(await resolveTelemetryState({ ...options, configDirectory: directory })).toEqual({
      enabled: false, source, config: null,
    });
    expect(await readdir(directory)).toEqual([]);
  });

  it('allows customer CI and defaults to enabled, while honoring saved consent', async () => {
    const options = { configDirectory: directory, env: { CI: 'true', GITHUB_ACTIONS: 'true', GITHUB_REPOSITORY: 'customer/project' } };
    expect(await resolveTelemetryState(options)).toMatchObject({ enabled: true, source: 'default' });
    await store.setEnabled(false);
    expect(await resolveTelemetryState(options)).toMatchObject({ enabled: false, source: 'config' });
  });
});
