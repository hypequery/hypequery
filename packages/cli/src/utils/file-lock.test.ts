import { mkdtemp, readFile, rm, stat, utimes, writeFile } from 'node:fs/promises';
import { hostname, tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { withFileLock } from './file-lock.js';

const directories: string[] = [];

async function target() {
  const directory = await mkdtemp(path.join(tmpdir(), 'hypequery-lock-test-'));
  directories.push(directory);
  const file = path.join(directory, 'store.json');
  return { file, lock: `${file}.lock` };
}

function owner(pid: number, host = hostname()) {
  return `${JSON.stringify({ id: 'another-process', pid, host })}\n`;
}

afterEach(async () => {
  await Promise.all(directories.splice(0).map(directory => rm(directory, { force: true, recursive: true })));
});

describe('withFileLock', () => {
  it('runs one read-change-write at a time and removes the lock afterwards', async () => {
    const { file, lock } = await target();
    await writeFile(file, '0');
    await Promise.all(Array.from({ length: 12 }, () => withFileLock(file, async () => {
      const value = Number(await readFile(file, 'utf8'));
      await new Promise(resolve => setTimeout(resolve, 1));
      await writeFile(file, String(value + 1));
    }, { retryMs: 1 })));
    await expect(readFile(file, 'utf8')).resolves.toBe('12');
    await expect(stat(lock)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('releases the lock when the action throws', async () => {
    const { file, lock } = await target();
    await expect(withFileLock(file, async () => {
      throw new Error('failed inside');
    })).rejects.toThrow('failed inside');
    await expect(stat(lock)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('waits for a running process, then gives up naming the lock', async () => {
    const { file, lock } = await target();
    await writeFile(lock, owner(4242));
    let ran = false;
    await expect(withFileLock(file, async () => {
      ran = true;
    }, { waitMs: 30, retryMs: 5, isProcessAlive: () => true })).rejects.toThrow(lock);
    expect(ran).toBe(false);
    // The other process's lock is not ours to remove.
    await expect(readFile(lock, 'utf8')).resolves.toBe(owner(4242));
  });

  it('takes over a lock whose process is gone', async () => {
    const { file, lock } = await target();
    await writeFile(lock, owner(4242));
    await expect(withFileLock(file, async () => 'done', { waitMs: 30, isProcessAlive: () => false }))
      .resolves.toBe('done');
    await expect(stat(lock)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('judges a lock from another machine, or one with no owner, by age only', async () => {
    const { file, lock } = await target();
    const options = { waitMs: 30, retryMs: 5, isProcessAlive: () => false };
    await writeFile(lock, owner(4242, 'another-host'));
    await expect(withFileLock(file, async () => 'done', options)).rejects.toThrow(/Another hypequery command/);

    const old = new Date(Date.now() - 11 * 60_000);
    await utimes(lock, old, old);
    await expect(withFileLock(file, async () => 'done', options)).resolves.toBe('done');

    await writeFile(lock, '');
    await expect(withFileLock(file, async () => 'done', options)).rejects.toThrow(/Another hypequery command/);
    const stale = new Date(Date.now() - 6_000);
    await utimes(lock, stale, stale);
    await expect(withFileLock(file, async () => 'done', options)).resolves.toBe('done');
  });
});
