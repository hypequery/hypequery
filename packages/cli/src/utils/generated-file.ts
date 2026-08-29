import { randomUUID } from 'node:crypto';
import { chmod, mkdir, readFile, rename, stat, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';

export interface WriteGeneratedFileOptions {
  /**
   * Whether an existing destination may be replaced.
   *
   * Defaults to `false`, which makes the write an exclusive create: the
   * existence check and the write are a single filesystem operation, so a file
   * that appeared since the caller last looked raises
   * {@link GeneratedFileExistsError} instead of being silently clobbered.
   */
  overwrite?: boolean;
}

/**
 * Thrown when a non-overwriting write finds the destination already present.
 */
export class GeneratedFileExistsError extends Error {
  readonly code = 'EEXIST';

  constructor(readonly filePath: string) {
    super(`Refusing to overwrite existing file: ${filePath}`);
    this.name = 'GeneratedFileExistsError';
  }
}

export async function readGeneratedFile(filePath: string): Promise<string | undefined> {
  try {
    return await readFile(filePath, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return undefined;
    }
    throw error;
  }
}

/**
 * Permission bits of an existing file, or undefined when it does not exist.
 */
async function readExistingMode(filePath: string): Promise<number | undefined> {
  try {
    const stats = await stat(filePath);
    return stats.mode & 0o777;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return undefined;
    }
    throw error;
  }
}

export async function writeGeneratedFileAtomically(
  filePath: string,
  contents: string,
  options: WriteGeneratedFileOptions = {},
): Promise<void> {
  const resolvedPath = path.resolve(filePath);
  const outputDirectory = path.dirname(resolvedPath);

  await mkdir(outputDirectory, { recursive: true });

  if (!options.overwrite) {
    try {
      // O_EXCL: the destination is created only if it is still absent, so a
      // concurrent create between the caller's check and this write is never
      // lost.
      await writeFile(resolvedPath, contents, { flag: 'wx' });
      return;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
        throw new GeneratedFileExistsError(resolvedPath);
      }
      throw error;
    }
  }

  const temporaryPath = path.join(
    outputDirectory,
    `.${path.basename(resolvedPath)}.${process.pid}.${randomUUID()}.tmp`,
  );

  try {
    await writeFile(temporaryPath, contents);
    // rename() swaps in a new inode, so a mode the user customized on the
    // destination has to be carried over explicitly or it is silently reset.
    const existingMode = await readExistingMode(resolvedPath);
    if (existingMode !== undefined) {
      await chmod(temporaryPath, existingMode);
    }
    await rename(temporaryPath, resolvedPath);
  } catch (error) {
    await unlink(temporaryPath).catch(() => undefined);
    throw error;
  }
}
