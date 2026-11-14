import { randomUUID } from 'node:crypto';
import { link, mkdir, readFile, rename, stat, unlink, writeFile } from 'node:fs/promises';
import { hostname } from 'node:os';
import path from 'node:path';

/**
 * A lock file next to a file that several CLI processes read, change and
 * write back. Creating it with `wx` is atomic, so one process holds it at a
 * time and the others wait. The holder may sit in an operating-system vault
 * prompt with the event loop blocked, so a lock is not judged by age alone:
 * it is stale when the process that wrote it is gone, or when it is older
 * than any command could hold it.
 */
const WAIT_MS = 30_000;
const RETRY_MS = 50;
/** No command holds the lock this long, whatever its process id says. */
const STALE_AFTER_MS = 10 * 60_000;
/** A lock that never got its owner written (a crash between create and write). */
const UNREADABLE_STALE_AFTER_MS = 5_000;

export interface FileLockOptions {
  /** How long to wait for another process before giving up. */
  readonly waitMs?: number;
  readonly retryMs?: number;
  readonly now?: () => number;
  /** Whether `pid` is a running process on this machine. */
  readonly isProcessAlive?: (pid: number) => boolean;
}

interface LockOwner {
  readonly id: string;
  readonly pid: number;
  readonly host: string;
}

function defaultIsProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // EPERM: the process exists but belongs to someone else.
    return (error as NodeJS.ErrnoException).code !== 'ESRCH';
  }
}

function parseOwner(text: string): LockOwner | null {
  try {
    const parsed = JSON.parse(text) as Partial<LockOwner> | null;
    return parsed !== null
      && typeof parsed === 'object'
      && typeof parsed.id === 'string'
      && typeof parsed.host === 'string'
      && typeof parsed.pid === 'number'
      && Number.isInteger(parsed.pid)
      && parsed.pid > 0
      ? { id: parsed.id, pid: parsed.pid, host: parsed.host }
      : null;
  } catch {
    return null;
  }
}

function missing(error: unknown): boolean {
  return (error as NodeJS.ErrnoException).code === 'ENOENT';
}

/** The lock's contents when it is stale, or null when it is held or already gone. */
async function staleContents(
  lock: string,
  now: number,
  isProcessAlive: (pid: number) => boolean,
): Promise<string | null> {
  let text: string;
  let modified: number;
  try {
    text = await readFile(lock, 'utf8');
    modified = (await stat(lock)).mtimeMs;
  } catch (error) {
    if (missing(error)) return null;
    throw error;
  }
  const age = now - modified;
  if (age > STALE_AFTER_MS) return text;
  const owner = parseOwner(text);
  if (!owner) return age > UNREADABLE_STALE_AFTER_MS ? text : null;
  return owner.host === hostname() && !isProcessAlive(owner.pid) ? text : null;
}

/**
 * Removes a stale lock. Two waiters can both see the same stale lock; if this
 * one moves aside a lock the other has already replaced with its own, it puts
 * that lock back rather than letting a second process in.
 */
async function removeStale(lock: string, observed: string): Promise<void> {
  const aside = `${lock}.${randomUUID()}.stale`;
  try {
    await rename(lock, aside);
  } catch (error) {
    if (missing(error)) return;
    throw error;
  }
  const moved = await readFile(aside, 'utf8').catch(() => null);
  if (moved !== observed) await link(aside, lock).catch(() => undefined);
  await unlink(aside).catch(() => undefined);
}

/**
 * Runs `action` while holding the lock for `file` (`<file>.lock`), so a
 * read-change-write of `file` in one process can't interleave with another's.
 */
export async function withFileLock<T>(
  file: string,
  action: () => Promise<T>,
  options: FileLockOptions = {},
): Promise<T> {
  const lock = `${file}.lock`;
  const now = options.now ?? Date.now;
  const isProcessAlive = options.isProcessAlive ?? defaultIsProcessAlive;
  const contents = `${JSON.stringify({ id: randomUUID(), pid: process.pid, host: hostname() } satisfies LockOwner)}\n`;
  const deadline = now() + (options.waitMs ?? WAIT_MS);
  await mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  for (;;) {
    try {
      await writeFile(lock, contents, { encoding: 'utf8', flag: 'wx', mode: 0o600 });
      break;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    }
    const stale = await staleContents(lock, now(), isProcessAlive);
    if (stale !== null) {
      await removeStale(lock, stale);
      continue;
    }
    if (now() >= deadline) {
      throw new Error(
        `Another hypequery command is updating ${file}. Wait for it to finish and run this command again. `
        + `If no other hypequery command is running, delete ${lock}.`,
      );
    }
    await new Promise<void>(resolve => setTimeout(resolve, options.retryMs ?? RETRY_MS));
  }
  try {
    return await action();
  } finally {
    // Only this process's own lock: one judged stale and replaced is not ours to remove.
    const current = await readFile(lock, 'utf8').catch(() => null);
    if (current === contents) await unlink(lock).catch(() => undefined);
  }
}
