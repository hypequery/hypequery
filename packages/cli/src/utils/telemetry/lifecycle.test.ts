import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CommandLifecycle } from './lifecycle.js';
import { TelemetryInvocation } from './invocation.js';
import { CommandExit, exitWith, installCommandExitFinalizer } from '../command-exit.js';
import { TelemetryConfigStore } from './config-store.js';
import { resolveTelemetryState } from './opt-out.js';
import { exceptionClass, telemetryErrorCode } from './error-code.js';
import { updateCommandTelemetry, withCommandTelemetry } from './command-context.js';

describe('CLI telemetry lifecycle', () => {
  let directory: string;
  beforeEach(async () => { directory = await mkdtemp(path.join(tmpdir(), 'hq-lifecycle-')); });
  afterEach(async () => { vi.restoreAllMocks(); await rm(directory, { recursive: true, force: true }); });
  it('records a command exactly once, with flag names and shared anonymous context', async () => {
    const write = vi.fn();
    const lifecycle = new CommandLifecycle(['generate', '--tables=PRIVATE_TABLE', '--output', '/PRIVATE_PATH'], {
      configDirectory: directory, cwd: directory, env: { HYPEQUERY_TELEMETRY_DEBUG: '1' },
      contextOptions: { isTTY: false }, transportOptions: { write },
    });
    await lifecycle.begin('generate', 'chdb');
    await Promise.all([lifecycle.finish(new CommandExit(0, 'success')), lifecycle.finish(new CommandExit(1, 'failure'))]);
    expect(write).toHaveBeenCalledTimes(1);
    const event = JSON.parse(write.mock.calls[0][0]);
    expect(event.properties).toMatchObject({ command: 'generate', database: 'chdb', outcome: 'success', flags_used: ['--output', '--tables'] });
    expect(write.mock.calls[0][0]).not.toContain('PRIVATE');
  });
  it('treats long-running signals as interrupted and preserves exit codes', async () => {
    const write = vi.fn();
    const lifecycle = new CommandLifecycle(['mcp'], { configDirectory: directory, cwd: directory, env: { HYPEQUERY_TELEMETRY_DEBUG: '1' }, contextOptions: { isTTY: false }, transportOptions: { write } });
    await lifecycle.begin('mcp');
    lifecycle.markInterrupted();
    await lifecycle.finish(new CommandExit(0, 'success'));
    expect(JSON.parse(write.mock.calls[0][0]).properties.outcome).toBe('interrupted');
  });
  it('isolates concurrent command metrics and ignores mismatched command updates', async () => {
    const write = vi.fn();
    const options = { configDirectory: directory, cwd: directory, env: { HYPEQUERY_TELEMETRY_DEBUG: '1' }, contextOptions: { isTTY: false }, transportOptions: { write } };
    const init = new CommandLifecycle(['init'], options);
    const generate = new CommandLifecycle(['generate'], options);
    await init.begin('init');
    await generate.begin('generate');
    await Promise.all([
      withCommandTelemetry(init, async () => {
        await Promise.resolve();
        updateCommandTelemetry('init', { style: 'datasets', table_count_bucket: undefined });
        updateCommandTelemetry('generate', { custom_output: true });
      }),
      withCommandTelemetry(generate, async () => {
        await Promise.resolve();
        updateCommandTelemetry('generate', { custom_output: false });
      }),
    ]);
    await init.finish(new CommandExit(0, 'success'));
    await generate.finish(new CommandExit(0, 'success'));
    const events = write.mock.calls.map(([event]) => JSON.parse(event));
    expect(events).toHaveLength(2);
    expect(events[0].properties).toMatchObject({ command: 'init', style: 'datasets' });
    expect(events[0].properties).not.toHaveProperty('custom_output');
    expect(events[0].properties).not.toHaveProperty('table_count_bucket');
    expect(events[1].properties).toMatchObject({ command: 'generate', custom_output: false });
    expect(events[1].properties).not.toHaveProperty('style');
  });
  it('debug and staged transport still honor every opt-out and suppress preference-command events', async () => {
    for (const env of [{ HYPEQUERY_TELEMETRY_DEBUG: '1', DO_NOT_TRACK: '1' }, { HYPEQUERY_TELEMETRY_DEBUG: '1', NODE_ENV: 'test' }, {}]) {
      expect(await TelemetryInvocation.create({ command: 'init', configDirectory: directory, env })).toBeNull();
    }
    expect(await TelemetryInvocation.create({ command: 'telemetry', configDirectory: directory, env: { HYPEQUERY_TELEMETRY_DEBUG: '1' } })).toBeNull();
    expect(await new TelemetryConfigStore({ configDirectory: directory }).peek()).toBeNull();
  });
  it('persists a version-specific kill switch without disabling future releases or changing saved consent', async () => {
    const options = { configDirectory: directory, env: {} };
    const store = new TelemetryConfigStore(options);
    await store.load();
    await store.disableVersion('1.22.0');
    await store.setEnabled(true);
    expect(await resolveTelemetryState({ ...options, cliVersion: '1.22.0' })).toMatchObject({ enabled: false, source: 'kill_switch' });
    expect(await resolveTelemetryState({ ...options, cliVersion: '1.22.1' })).toMatchObject({ enabled: true });
  });
  it('routes command exits as typed control flow only while the executable owns finalization', () => {
    const restore = installCommandExitFinalizer(async () => undefined);
    try {
      expect(() => exitWith(130, 'cancelled', 'prompt_cancelled')).toThrow(CommandExit);
      try { exitWith(1, 'failure', 'auth_failed'); } catch (error) {
        expect(error).toMatchObject({ exitCode: 1, outcome: 'failure', errorCode: 'auth_failed' });
      }
    } finally { restore(); }
  });
  it('classifies errors without forwarding messages, custom names or stacks', () => {
    expect(telemetryErrorCode(Object.assign(new Error('PRIVATE'), { code: 'ECONNREFUSED' }))).toBe('connection_failed');
    expect(telemetryErrorCode(new Error('Authentication failed for PRIVATE'))).toBe('auth_failed');
    expect(telemetryErrorCode(new Error('Build failed: PRIVATE_PATH'))).toBe('compile_error');
    expect(telemetryErrorCode('PRIVATE')).toBe('unknown');
    expect(telemetryErrorCode(Object.assign(new Error('PRIVATE'), { code: 'PRIVATE_CODE' }))).toBe('unknown');
    expect(exceptionClass(Object.assign(new TypeError('PRIVATE'), { name: 'PRIVATE_NAME' }))).toBe('TypeError');
    expect(exceptionClass('PRIVATE')).toBe('unknown');
  });
});
