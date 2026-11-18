import { chmod, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { configDirectory } from './config-directory.js';
import type { DeviceAuthorization } from './device-sign-in.js';

/**
 * A device sign-in started by `hypequery login --device --no-wait` and not
 * finished yet. Agents cannot watch a command that waits minutes for a
 * person, so the CLI prints the code, exits, and finishes on the next run.
 * The device code can be exchanged for a token once approved, so the file is
 * owner-only, like the management-token fallback beside it.
 */
export interface PendingDeviceSignIn extends DeviceAuthorization {
  readonly origin: string;
  readonly project?: string;
  readonly capabilities?: readonly string[];
}

export interface PendingStoreDependencies {
  readonly configDirectory?: string;
  readonly env?: Readonly<Record<string, string | undefined>>;
  readonly platform?: NodeJS.Platform;
}

function file(dependencies: PendingStoreDependencies): string {
  const directory = dependencies.configDirectory
    ?? configDirectory(dependencies.env ?? process.env, dependencies.platform ?? process.platform);
  return path.join(directory, 'device-sign-in.json');
}

function isPending(value: unknown): value is PendingDeviceSignIn {
  if (typeof value !== 'object' || value === null) return false;
  const record = value as Record<string, unknown>;
  return typeof record.origin === 'string' && typeof record.deviceCode === 'string' && typeof record.userCode === 'string'
    && typeof record.verificationUri === 'string' && typeof record.expiresAt === 'number' && typeof record.interval === 'number';
}

export async function loadPendingDeviceSignIn(dependencies: PendingStoreDependencies = {}): Promise<PendingDeviceSignIn | null> {
  try {
    const parsed: unknown = JSON.parse(await readFile(file(dependencies), 'utf8'));
    return isPending(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export async function savePendingDeviceSignIn(pending: PendingDeviceSignIn, dependencies: PendingStoreDependencies = {}): Promise<void> {
  const target = file(dependencies);
  await mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
  await writeFile(target, `${JSON.stringify(pending)}\n`, { mode: 0o600 });
  await chmod(target, 0o600);
}

export async function deletePendingDeviceSignIn(dependencies: PendingStoreDependencies = {}): Promise<void> {
  await rm(file(dependencies), { force: true });
}

/** Whether a saved sign-in was asked for with the same origin, project and capabilities. */
export function samePendingRequest(
  pending: PendingDeviceSignIn,
  request: { origin: string; project?: string; capabilities?: readonly string[] },
): boolean {
  const capabilities = (list: readonly string[] | undefined) => (list ? [...list].sort().join(',') : '');
  return pending.origin === request.origin
    && (pending.project ?? '') === (request.project ?? '')
    && capabilities(pending.capabilities) === capabilities(request.capabilities);
}
