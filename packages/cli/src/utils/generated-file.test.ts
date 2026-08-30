import { chmod, mkdtemp, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  GeneratedFileExistsError,
  readGeneratedFile,
  writeGeneratedFileAtomically,
} from './generated-file.js';

// Real filesystem behavior throughout; the spy only records how the temporary
// file was created, which is not observable after the rename.
const writeFileSpy = vi.hoisted(() => vi.fn());
vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  writeFileSpy.mockImplementation(actual.writeFile);
  return { ...actual, default: actual, writeFile: writeFileSpy };
});

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
    await writeGeneratedFileAtomically(filePath, 'second', { overwrite: true });

    await expect(readFile(filePath, 'utf8')).resolves.toBe('second');
    await expect(readdir(path.dirname(filePath))).resolves.toEqual(['datasets.ts']);
  });

  it('refuses to replace a file that appeared since the caller last looked', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'hq-generated-file-'));
    temporaryDirectories.push(directory);
    const filePath = path.join(directory, 'datasets.ts');

    // Stands in for a concurrent editor or CLI run writing between the
    // command's read and its write.
    await writeFile(filePath, 'written by someone else');

    await expect(writeGeneratedFileAtomically(filePath, 'regenerated'))
      .rejects.toBeInstanceOf(GeneratedFileExistsError);
    await expect(readFile(filePath, 'utf8')).resolves.toBe('written by someone else');
    await expect(readdir(directory)).resolves.toEqual(['datasets.ts']);
  });

  it('never creates the temporary file more permissively than the file it replaces', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'hq-generated-file-'));
    temporaryDirectories.push(directory);
    const filePath = path.join(directory, 'datasets.ts');

    await writeGeneratedFileAtomically(filePath, 'first');
    await chmod(filePath, 0o600);
    writeFileSpy.mockClear();

    await writeGeneratedFileAtomically(filePath, 'second', { overwrite: true });

    // The temp file is created at the destination's mode, so its contents are
    // never briefly readable by other local users in a shared directory.
    const [temporaryPath, , options] = writeFileSpy.mock.calls[0];
    expect(String(temporaryPath)).toContain('.tmp');
    expect(options).toEqual({ mode: 0o600 });
  });

  it('preserves customized permissions when replacing a file', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'hq-generated-file-'));
    temporaryDirectories.push(directory);
    const filePath = path.join(directory, 'datasets.ts');

    await writeGeneratedFileAtomically(filePath, 'first');
    await chmod(filePath, 0o640);

    await writeGeneratedFileAtomically(filePath, 'second', { overwrite: true });

    const stats = await stat(filePath);
    expect(stats.mode & 0o777).toBe(0o640);
    await expect(readFile(filePath, 'utf8')).resolves.toBe('second');
  });
});
