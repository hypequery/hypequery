import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';

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

export async function writeGeneratedFileAtomically(
  filePath: string,
  contents: string,
): Promise<void> {
  const resolvedPath = path.resolve(filePath);
  const outputDirectory = path.dirname(resolvedPath);
  const temporaryPath = path.join(
    outputDirectory,
    `.${path.basename(resolvedPath)}.${process.pid}.${randomUUID()}.tmp`,
  );

  await mkdir(outputDirectory, { recursive: true });
  try {
    await writeFile(temporaryPath, contents);
    await rename(temporaryPath, resolvedPath);
  } catch (error) {
    await unlink(temporaryPath).catch(() => undefined);
    throw error;
  }
}
