import { createHash, randomUUID } from 'node:crypto';
import { hostname } from 'node:os';
import { mkdir, readdir, rename, rm, rmdir, stat, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

/**
 * Cross-process lock for the telemetry settings file.
 *
 * The lock is a directory holding exactly one owner file named
 * `owner.<pid>.<host>.<token>`. It is published with an atomic rename, so it
 * never exists without an owner. A writer never removes a lock it does not own:
 *
 * - Recovery takes over a lock only when its owner process no longer exists on
 *   this host, by renaming that exact owner file to the new owner's name. The
 *   rename fails if the lock was already replaced or taken over, so concurrent
 *   recoverers cannot both win and a replacement lock is never touched.
 * - A live owner keeps its lock however long it runs: age is never evidence of
 *   abandonment, because a slow or suspended writer is still alive.
 * - Release deletes only this writer's own owner file.
 *
 * A lock owned on another host (shared home directory) cannot be checked and
 * fails closed. PID reuse makes a dead owner look alive, which also fails closed.
 */

export interface SettingsLockIdentity {
  /** Owner process ID; injectable so tests can model separate processes. */
  readonly pid: number;
  /** Liveness of a process on this host. */
  readonly isAlive: (pid: number) => boolean;
  readonly host: string;
}

export interface SettingsLock {
  /** Removes this writer's ownership only; never another writer's lock. */
  release(): Promise<void>;
}

/** Only an ownerless lock (mid-publish crash on platforms without dir replace) ages out. */
export const ORPHANED_LOCK_MS = 10_000;

const OWNER = /^owner\.(\d+)\.([0-9a-f]{12})\.([0-9a-f-]{36})$/;

export function processIsAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // EPERM: the process exists but belongs to another user.
    return (error as NodeJS.ErrnoException).code !== 'ESRCH';
  }
}

export function localIdentity(): SettingsLockIdentity {
  return { pid: process.pid, isAlive: processIsAlive, host: hostname() };
}

function hostHash(host: string): string {
  return createHash('sha256').update(host).digest('hex').slice(0, 12);
}

/** Acquires the lock, retrying a held one up to `attempts` times; null when unavailable. */
export async function acquireSettingsLock(
  directory: string,
  attempts: number,
  identity: SettingsLockIdentity = localIdentity(),
): Promise<SettingsLock | null> {
  const lockPath = path.join(directory, 'telemetry.lock');
  const owner = `owner.${identity.pid}.${hostHash(identity.host)}.${randomUUID()}`;
  const staged = path.join(directory, `telemetry.lock.${randomUUID()}.tmp`);
  await mkdir(staged, { mode: 0o700 });
  try {
    await writeFile(path.join(staged, owner), '', { flag: 'wx', mode: 0o600 });
    for (let attempt = 0; attempt < attempts; attempt++) {
      if (await publish(staged, lockPath) || await takeOver(lockPath, owner, identity)) {
        return { release: () => release(lockPath, owner) };
      }
      if (attempt + 1 < attempts) await delay(10);
    }
    return null;
  } finally {
    await rm(staged, { recursive: true, force: true }).catch(() => undefined);
  }
}

/** Atomically publishes the staged lock; false when a lock already exists. */
async function publish(staged: string, lockPath: string): Promise<boolean> {
  try {
    await rename(staged, lockPath);
    return true;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'EEXIST' || code === 'ENOTEMPTY' || code === 'EPERM' || code === 'EACCES' || code === 'ENOENT') return false;
    throw error;
  }
}

/** Takes over a lock whose owner is dead on this host; never touches a live or replaced lock. */
async function takeOver(lockPath: string, owner: string, identity: SettingsLockIdentity): Promise<boolean> {
  let entries: string[];
  try {
    entries = await readdir(lockPath);
  } catch {
    return false;
  }
  const owners = entries.filter(entry => entry.startsWith('owner.'));
  if (owners.length === 0) {
    // Ownerless: a publish or release in progress, or one interrupted on a
    // platform where rename cannot replace an empty directory. rmdir only
    // removes it while still empty, so a newly published lock survives.
    try {
      if (Date.now() - (await stat(lockPath)).mtimeMs >= ORPHANED_LOCK_MS) await rmdir(lockPath);
    } catch { /* Not empty, already gone, or unavailable. */ }
    return false;
  }
  const match = owners.length === 1 ? OWNER.exec(owners[0]) : null;
  if (!match || match[2] !== hostHash(identity.host) || identity.isAlive(Number(match[1]))) return false;
  try {
    // Conditional on that exact owner file: only one recoverer can succeed.
    await rename(path.join(lockPath, owners[0]), path.join(lockPath, owner));
    return true;
  } catch {
    return false;
  }
}

async function release(lockPath: string, owner: string): Promise<void> {
  try {
    await unlink(path.join(lockPath, owner));
  } catch {
    // Not ours any more (or unavailable): never remove someone else's lock.
    return;
  }
  // Removes the directory only while empty; a lock published meanwhile survives.
  await rmdir(lockPath).catch(() => undefined);
}
