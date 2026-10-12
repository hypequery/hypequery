import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** Hands one serialized batch to delivery; must return without waiting on the network. */
export type DispatchBatch = (url: URL, body: string) => void;

export const BATCH_DIRECTORY_PREFIX = 'hypequery-telemetry-';
export const BATCH_FILE = 'batch.json';
const SENDER = fileURLToPath(new URL('./detached-sender.js', import.meta.url));

function removeQuietly(directory: string): void {
  try { rmSync(directory, { recursive: true, force: true }); } catch { /* A stray temporary file is harmless. */ }
}

/**
 * The CLI's exit budget is too short for a TLS handshake plus a serverless cold
 * start, so a detached child delivers the batch and the command exits at once.
 * The batch travels through a private temporary file: argv and env are capped
 * near 32 KiB on Windows, and pipe writes still buffered at exit are lost.
 */
export const dispatchDetached: DispatchBatch = (url, body) => {
  const directory = mkdtempSync(path.join(tmpdir(), BATCH_DIRECTORY_PREFIX));
  try {
    writeFileSync(path.join(directory, BATCH_FILE), JSON.stringify({ endpoint: url.href, body }), { mode: 0o600, flag: 'wx' });
    const child = spawn(process.execPath, [SENDER, directory], { detached: true, stdio: 'ignore', windowsHide: true });
    child.on('error', () => { removeQuietly(directory); });
    child.unref();
  } catch (error) {
    removeQuietly(directory);
    throw error;
  }
};
