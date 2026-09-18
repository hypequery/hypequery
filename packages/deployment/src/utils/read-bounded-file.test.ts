import { appendFile, mkdtemp, open, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { readBoundedFile } from './read-bounded-file.js';

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(directories.splice(0).map(directory => rm(directory, { recursive: true, force: true })));
});

it('rejects a file that grows beyond the limit after it is opened', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'hypequery-bounded-file-'));
  directories.push(directory);
  const file = path.join(directory, 'file');
  await writeFile(file, 'abc');
  const handle = await open(file, 'r');
  try {
    await appendFile(file, 'd');
    await expect(readBoundedFile(handle, 3, 1, 'too large')).rejects.toThrow('too large');
  } finally {
    await handle.close();
  }
});

it('allows an empty source file but rejects an empty required record', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'hypequery-bounded-file-'));
  directories.push(directory);
  const file = path.join(directory, 'file');
  await writeFile(file, '');
  const handle = await open(file, 'r');
  try {
    await expect(readBoundedFile(handle, 0, 0, 'invalid')).resolves.toHaveLength(0);
    await expect(readBoundedFile(handle, 1, 1, 'invalid')).rejects.toThrow('invalid');
  } finally {
    await handle.close();
  }
});
