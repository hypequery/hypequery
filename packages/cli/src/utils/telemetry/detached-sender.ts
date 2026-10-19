import { readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { getCliVersion } from '../cli-version.js';
import { deliverBatch } from './delivery.js';
import { BATCH_DIRECTORY_PREFIX, BATCH_FILE } from './detached-dispatch.js';
import { telemetryEndpoint } from './endpoint.js';

/** Entry point of the child started by dispatchDetached; the CLI never imports it. */
async function send(directory: string | undefined): Promise<void> {
  if (!directory || !path.basename(directory).startsWith(BATCH_DIRECTORY_PREFIX)) return;
  let batch: unknown;
  try {
    batch = JSON.parse(await readFile(path.join(directory, BATCH_FILE), 'utf8'));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
  if (!batch || typeof batch !== 'object') return;
  const { endpoint, body } = batch as Record<string, unknown>;
  const url = telemetryEndpoint(typeof endpoint === 'string' ? endpoint : undefined);
  if (!url || typeof body !== 'string') return;
  await deliverBatch(url, body, {
    onDisabled: async () => {
      const { TelemetryConfigStore } = await import('./config-store.js');
      return new TelemetryConfigStore().disableVersion(getCliVersion());
    },
  });
}

await send(process.argv[2]).catch(() => undefined);
