import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { readGeneratedFile, writeGeneratedFileAtomically } from './generated-file.js';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe('generated file utilities', () => {
  it('returns undefined for a missing file', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'hq-generated-file-'));
    temporaryDirectories.push(directory);

    await expect(readGeneratedFile(path.join(directory, 'missing.ts'))).resolves.toBeUndefined();
  });

  it('atomically creates and replaces a generated file without leaving temporary files', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'hq-generated-file-'));
    temporaryDirectories.push(directory);
    const filePath = path.join(directory, 'nested', 'datasets.ts');

    await writeGeneratedFileAtomically(filePath, 'first');
    await writeGeneratedFileAtomically(filePath, 'second');

    await expect(readFile(filePath, 'utf8')).resolves.toBe('second');
    await expect(readdir(path.dirname(filePath))).resolves.toEqual(['datasets.ts']);
  });
});
