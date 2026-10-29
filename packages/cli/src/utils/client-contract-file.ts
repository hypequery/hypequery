import { constants } from 'node:fs';
import { lstat, open } from 'node:fs/promises';
import path from 'node:path';
import { ProtocolClientContractError } from '@hypequery/protocol';

/** Refuse filesystem indirection for generated output and its existing ancestors. */
export async function checkClientOutputPath(filePath: string): Promise<void> {
  let current = path.resolve(filePath);
  while (true) {
    try {
      const info = await lstat(current);
      if (info.isSymbolicLink() || (current === path.resolve(filePath) ? !info.isFile() : !info.isDirectory())) {
        throw new Error('Client output must be a regular file under ordinary directories.');
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    const parent = path.dirname(current);
    if (parent === current) return;
    current = parent;
  }
}

/** Bound allocation before reading; O_NOFOLLOW also refuses a swapped final symlink. */
export async function readClientArtifact(filePath: string, maxBytes = 1_048_576): Promise<string> {
  const handle = await open(filePath, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const before = await handle.stat();
    if (!before.isFile() || before.size > maxBytes) throw new Error('Client artifact must be a regular file within the byte limit.');
    const buffer = Buffer.alloc(maxBytes + 1);
    let size = 0;
    while (size < buffer.length) {
      const { bytesRead } = await handle.read(buffer, size, buffer.length - size, null);
      if (!bytesRead) break;
      size += bytesRead;
    }
    const after = await handle.stat();
    if (size > maxBytes || before.size !== after.size || before.mtimeMs !== after.mtimeMs || before.ctimeMs !== after.ctimeMs) {
      throw new Error('Client artifact exceeded its byte limit or changed while reading.');
    }
    return new TextDecoder('utf-8', { fatal: true }).decode(buffer.subarray(0, size));
  } finally { await handle.close(); }
}

export async function readClientOutput(filePath: string): Promise<string | undefined> {
  try { return await readClientArtifact(filePath, 16 * 1_048_576); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw error;
  }
}

/**
 * Say where a client contract is invalid. An unknown field usually means the
 * contract was exported by a newer hypequery than this CLI understands.
 */
export function describeClientContractError(error: unknown): unknown {
  if (!(error instanceof ProtocolClientContractError)) return error;
  const where = error.path ? ` at ${error.path}` : '';
  const hint = error.code === 'HQ_CLIENT_UNKNOWN_FIELD'
    ? ' The contract may come from a newer hypequery than this CLI; upgrade @hypequery/cli.'
    : '';
  return new Error(`${error.message.replace(/\.$/, '')}${where} (${error.code}).${hint}`, { cause: error });
}
