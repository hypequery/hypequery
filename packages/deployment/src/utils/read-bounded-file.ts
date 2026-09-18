import type { FileHandle } from 'node:fs/promises';

/** Read at most the declared limit, including when a file grows after stat. */
export async function readBoundedFile(
  handle: FileHandle,
  maximum: number,
  minimum: number,
  errorMessage: string,
): Promise<Buffer> {
  const buffer = Buffer.allocUnsafe(Math.min(64 * 1024, maximum + 1));
  const chunks: Buffer[] = [];
  let total = 0;
  while (total <= maximum) {
    const { bytesRead } = await handle.read(buffer, 0, Math.min(buffer.length, maximum + 1 - total), null);
    if (bytesRead === 0) break;
    total += bytesRead;
    if (total > maximum) throw new Error(errorMessage);
    chunks.push(Buffer.from(buffer.subarray(0, bytesRead)));
  }
  if (total < minimum) throw new Error(errorMessage);
  return Buffer.concat(chunks, total);
}
