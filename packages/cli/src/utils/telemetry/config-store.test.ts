import { chmod, mkdtemp, readFile, readdir, rm, stat, writeFile, mkdir, utimes } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { TelemetryConfigStore, settleTelemetrySettings } from './config-store.js';
import { acquireSettingsLock, type SettingsLockIdentity } from './settings-lock.js';
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

  it("fails closed on a live writer's lock and leaves it alone", async () => {
    // This test process is alive, so a lock it owns is a live writer's lock.
    await acquireSettingsLock(directory, 1);
    const held = await readdir(path.join(directory, 'telemetry.lock'));
    expect(await store.load()).toBeNull();
    expect(await readdir(directory)).toEqual(['telemetry.lock']);
    expect(await readdir(path.join(directory, 'telemetry.lock'))).toEqual(held);
  });
  it('takes over a lock whose owner process died, for opt-out and the kill switch', async () => {
    const config = await store.load();
    const dead = new Set<number>();
    const identity = (pid: number): SettingsLockIdentity => ({ pid, host: 'test-host', isAlive: candidate => !dead.has(candidate) });
    const recovering = new TelemetryConfigStore({ configDirectory: directory, env: {}, lockIdentity: identity(200) });
    for (const write of [() => recovering.setEnabled(false), () => recovering.disableVersion('1.22.0')]) {
      // What SIGKILL or a crash mid-write leaves: a lock owned by a process that no longer exists.
      expect(await acquireSettingsLock(directory, 1, identity(100))).not.toBeNull();
      dead.add(100);
      expect(await write()).toMatchObject({ install_id: config?.install_id });
      expect(await readdir(directory)).toEqual(['telemetry.json']);
      dead.delete(100);
    }
    expect(await store.peek()).toMatchObject({ enabled: false, disabled_cli_versions: ['1.22.0'] });
  });
  it('never lets a slow live writer lose its lock, so it cannot overwrite a disable', async () => {
    await store.load();
    const live = (pid: number): SettingsLockIdentity => ({ pid, host: 'test-host', isAlive: () => true });
    // A suspended writer, holding its lock far longer than any write takes.
    const slow = await acquireSettingsLock(directory, 1, live(100));
    const ancient = new Date(Date.now() - 60 * 60 * 1000);
    await utimes(path.join(directory, 'telemetry.lock'), ancient, ancient);
    const disabling = new TelemetryConfigStore({ configDirectory: directory, env: {}, lockIdentity: live(200) });
    expect(await disabling.setEnabled(false)).toBeNull();
    expect(await store.peek()).toMatchObject({ enabled: true });
    await slow!.release();
    expect(await disabling.setEnabled(false)).toMatchObject({ enabled: false });
  });
  it('persists a version kill switch without leaving settings locked', async () => {
    const config = await store.load();
    expect(await store.disableVersion('1.22.0')).toEqual({ ...config, disabled_cli_versions: ['1.22.0'] });
    expect(await readdir(directory)).toEqual(['telemetry.json']);
    expect(await store.setEnabled(false)).toMatchObject({ enabled: false, disabled_cli_versions: ['1.22.0'] });
    // One immediate attempt against a live writer: no wait, no change.
    await acquireSettingsLock(directory, 1);
    expect(await store.disableVersion('1.23.0')).toBeNull();
    expect(await readdir(directory)).toEqual(['telemetry.json', 'telemetry.lock']);
  });

  it('lets exit wait for an in-progress write to release its lock', async () => {
    await store.load();
    const pending = store.setEnabled(false);
    await settleTelemetrySettings();
    expect(await readdir(directory)).toEqual(['telemetry.json']);
    expect(await pending).toMatchObject({ enabled: false });
  });
  it('bounds the exit wait when a write cannot finish', async () => {
    await store.load();
    let release!: () => void;
    const released = new Promise<void>(resolve => { release = resolve; });
    const blocked = store.showNotice(() => released);
    const started = performance.now();
    await settleTelemetrySettings(50);
    expect(performance.now() - started).toBeLessThan(500);
    release();
    await blocked;
    expect(await readdir(directory)).toEqual(['telemetry.json']);
  });
  it('does not create settings from a kill switch', async () => {
    expect(await store.disableVersion('1.22.0')).toBeNull();
    expect(await readdir(directory)).toEqual([]);
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
