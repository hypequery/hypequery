import { mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { showTelemetryNotice, TELEMETRY_NOTICE } from './notice.js';
import { TelemetryConfigStore } from './config-store.js';

describe('first-run disclosure', () => {
  let directory: string;
  beforeEach(async () => { directory = await mkdtemp(path.join(tmpdir(), 'hq-notice-')); });
  afterEach(async () => { await rm(directory, { recursive: true, force: true }); });
  it('displays exactly once across concurrent interactive runs and then persists', async () => {
    const write = vi.fn(async () => undefined);
    const options = { configDirectory: directory, env: {}, enabled: true, command: 'init', isTTY: true, isCI: false, write };
    await Promise.all(Array.from({ length: 5 }, () => showTelemetryNotice(options)));
    expect(write).toHaveBeenCalledExactlyOnceWith(TELEMETRY_NOTICE);
    expect((await new TelemetryConfigStore(options).peek())?.notice_shown_at).toBeDefined();
    await showTelemetryNotice(options);
    expect(write).toHaveBeenCalledTimes(1);
  });
  it.each([
    { command: 'mcp' }, { command: 'telemetry' }, { enabled: false }, { isTTY: false }, { isCI: true },
  ])('suppresses the notice for %j', async override => {
    const write = vi.fn(async () => undefined);
    await showTelemetryNotice({ configDirectory: directory, env: {}, enabled: true, command: 'init', isTTY: true, isCI: false, write, ...override });
    expect(write).not.toHaveBeenCalled();
    expect(await new TelemetryConfigStore({ configDirectory: directory }).peek()).toBeNull();
  });
  it('does not mark disclosure as shown when stderr fails', async () => {
    await showTelemetryNotice({ configDirectory: directory, env: {}, enabled: true, command: 'init', isTTY: true, isCI: false, write: async () => { throw new Error('broken stderr'); } });
    expect((await new TelemetryConfigStore({ configDirectory: directory }).peek())?.notice_shown_at).toBeUndefined();
  });
});
