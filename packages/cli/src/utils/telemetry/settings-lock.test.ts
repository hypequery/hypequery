import { mkdir, mkdtemp, readdir, rm, utimes } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ORPHANED_LOCK_MS, acquireSettingsLock, type SettingsLockIdentity } from './settings-lock.js';

// Lets a test hand a recoverer a stale directory listing, as if another process
// replaced the lock between the recoverer's read and its takeover.
const staleListing = vi.hoisted(() => ({ entries: undefined as string[] | undefined }));
vi.mock('node:fs/promises', async () => {
  const actual = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises');
  return {
    ...actual,
    readdir: (async (...args: Parameters<typeof actual.readdir>) => {
      if (staleListing.entries && String(args[0]).endsWith('telemetry.lock')) return staleListing.entries;
      return actual.readdir(...args);
    }) as typeof actual.readdir,
  };
});

const HOST = 'test-host';
const dead = new Set<number>();
const as = (pid: number): SettingsLockIdentity => ({ pid, host: HOST, isAlive: candidate => !dead.has(candidate) });
const owners = async (directory: string) => (await readdir(path.join(directory, 'telemetry.lock'))).sort();
const ownerPid = (name: string) => Number(name.split('.')[1]);

describe('telemetry settings lock', () => {
  let directory: string;
  beforeEach(async () => {
    directory = await mkdtemp(path.join(tmpdir(), 'hq-settings-lock-'));
    dead.clear();
    staleListing.entries = undefined;
  });
  afterEach(async () => { await rm(directory, { recursive: true, force: true }); });

  it('publishes one owned lock and removes it on release', async () => {
    const lock = await acquireSettingsLock(directory, 1, as(100));
    expect((await owners(directory)).map(ownerPid)).toEqual([100]);
    expect(await acquireSettingsLock(directory, 1, as(200))).toBeNull();
    await lock!.release();
    expect(await readdir(directory)).toEqual([]);
  });

  it('never reclaims an old lock whose owner is still alive', async () => {
    // A slow or suspended writer: alive, holding its lock far past any age limit.
    await acquireSettingsLock(directory, 1, as(100));
    const ancient = new Date(Date.now() - 60 * 60 * 1000);
    await utimes(path.join(directory, 'telemetry.lock'), ancient, ancient);
    const before = await owners(directory);
    expect(await acquireSettingsLock(directory, 3, as(200))).toBeNull();
    expect(await owners(directory)).toEqual(before);
  });

  it('takes over a dead owner exactly once under concurrent recovery', async () => {
    await acquireSettingsLock(directory, 1, as(100));
    dead.add(100);
    const recoverers = Array.from({ length: 16 }, (_, index) => acquireSettingsLock(directory, 1, as(200 + index)));
    const locks = await Promise.all(recoverers);
    const winners = locks.flatMap((lock, index) => lock ? [200 + index] : []);
    expect(winners).toHaveLength(1);
    expect((await owners(directory)).map(ownerPid)).toEqual(winners);
  });

  it('does not touch a replacement lock when its view of the owner is stale', async () => {
    await acquireSettingsLock(directory, 1, as(100));
    const [deadOwner] = await owners(directory);
    dead.add(100);
    const replacement = await acquireSettingsLock(directory, 1, as(200));
    expect(replacement).not.toBeNull();
    const current = await owners(directory);
    // A third process still sees the dead owner and tries to take it over.
    staleListing.entries = [deadOwner];
    expect(await acquireSettingsLock(directory, 1, as(300))).toBeNull();
    staleListing.entries = undefined;
    expect(await owners(directory)).toEqual(current);
  });

  it("releases only its own ownership, never a lock taken over after it died", async () => {
    const original = await acquireSettingsLock(directory, 1, as(100));
    dead.add(100);
    await acquireSettingsLock(directory, 1, as(200));
    const taken = await owners(directory);
    // The original owner was presumed dead; its late release must not free the new owner's lock.
    await original!.release();
    expect(await owners(directory)).toEqual(taken);
  });

  it('never lets an ownerless lock block settings', async () => {
    // An empty lock has no owner to protect. POSIX rename replaces it at once;
    // where rename cannot replace a directory, it is cleared once old.
    const lockPath = path.join(directory, 'telemetry.lock');
    await mkdir(lockPath);
    const old = new Date(Date.now() - ORPHANED_LOCK_MS - 1_000);
    await utimes(lockPath, old, old);
    const lock = await acquireSettingsLock(directory, 2, as(100));
    expect(lock).not.toBeNull();
    expect((await owners(directory)).map(ownerPid)).toEqual([100]);
  });
});
