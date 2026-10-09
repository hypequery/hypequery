import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import http from 'node:http';
import https from 'node:https';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { telemetryCommand } from './telemetry.js';
import { TelemetryConfigStore } from '../utils/telemetry/config-store.js';

describe('telemetry command', () => {
  let directory: string;
  beforeEach(async () => {
    directory = await mkdtemp(path.join(tmpdir(), 'hypequery-telemetry-command-'));
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    // Telemetry sends through node:http(s); preference commands must not send.
    for (const client of [http, https]) {
      vi.spyOn(client, 'request').mockImplementation(() => { throw new Error('must not send'); });
    }
  });
  afterEach(async () => {
    vi.restoreAllMocks();
    await rm(directory, { recursive: true, force: true });
  });

  it('defaults to status, showing identity, effective source and docs', async () => {
    await telemetryCommand(undefined, { configDirectory: directory, env: {} });
    expect(console.log).toHaveBeenCalledWith('Telemetry: enabled (source: default)');
    expect(console.log).toHaveBeenCalledWith(expect.stringMatching(/^Install ID: [0-9a-f-]{36}$/));
    expect(console.log).toHaveBeenCalledWith('Learn more: https://hypequery.com/docs/telemetry');
    expect(http.request).not.toHaveBeenCalled();
    expect(https.request).not.toHaveBeenCalled();
  });

  it('persists disable without sending, and enable cannot override the environment', async () => {
    const options = { configDirectory: directory, env: { DO_NOT_TRACK: '1' } };
    await telemetryCommand('disable', options);
    expect(await new TelemetryConfigStore(options).peek()).toMatchObject({ enabled: false });
    await telemetryCommand('enable', options);
    expect(await new TelemetryConfigStore(options).peek()).toMatchObject({ enabled: true });
    expect(console.log).toHaveBeenCalledWith('Telemetry: disabled (source: DO_NOT_TRACK)');
    expect(http.request).not.toHaveBeenCalled();
    expect(https.request).not.toHaveBeenCalled();
  });

  it('reports a failed save without claiming success', async () => {
    await expect(telemetryCommand('disable', { env: {}, platform: 'linux' })).rejects.toThrow('Could not save');
    expect(console.log).not.toHaveBeenCalled();
  });

  it('rejects unknown actions without reflecting arbitrary input', async () => {
    await expect(telemetryCommand('secret-value')).rejects.toThrow('Usage: hypequery telemetry [status|enable|disable]');
    expect(console.log).not.toHaveBeenCalled();
  });
});
