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
 * Tightest of the permission bits observed on a destination, ignoring the
 * observations where it did not exist.
 *
 * A `chmod` that lands between two observations must not be undone by the
 * earlier snapshot, and the safe direction is always the more restrictive one:
 * the replacement is never more permissive than anything the destination was
 * seen to be.
 */
function mostRestrictiveMode(...modes: Array<number | undefined>): number | undefined {
  const observed = modes.filter((mode): mode is number => mode !== undefined);

  return observed.length > 0 ? observed.reduce((tightest, mode) => tightest & mode) : undefined;
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

  // Read the destination's mode first: the temporary file must never be created
  // more permissively than the file it replaces, or its contents are briefly
  // exposed to other local users in a shared directory.
  const existingMode = await readExistingMode(resolvedPath);

  try {
    await writeFile(
      temporaryPath,
      contents,
      existingMode !== undefined ? { mode: existingMode } : {},
    );

    // The destination can be chmod'ed — or created — while the contents above
    // are being written. Renaming with only the pre-write snapshot would undo
    // that, replacing a file just tightened to 0600 with a 0644 one, so the
    // tighter of the two observations wins.
    const destinationMode = mostRestrictiveMode(
      existingMode,
      await readExistingMode(resolvedPath),
    );

    // open() also applies the umask, and rename() swaps in a new inode, so the
    // destination's exact mode has to be restored explicitly or a customized
    // mode is silently reset. A chmod landing after this read still races the
    // rename — rename() cannot be made conditional on the destination's mode —
    // but the window is now two syscalls rather than the whole write.
    if (destinationMode !== undefined) {
      await chmod(temporaryPath, destinationMode);
    }
    await rename(temporaryPath, resolvedPath);
  } catch (error) {
    await unlink(temporaryPath).catch(() => undefined);
    throw error;
  }
}
