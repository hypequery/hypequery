import { constants } from 'node:fs';
import { lstat, open, realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import { ProtocolClientContractError } from '@hypequery/protocol';
import { pointer } from './json-pointer.js';

/** Refuse filesystem indirection for generated output and its existing ancestors. */
export async function checkClientOutputPath(filePath: string): Promise<void> {
  const target = path.resolve(filePath);
  let current = target;
  while (true) {
    try {
      const info = await lstat(current);
      if (info.isSymbolicLink()) throw await throughLink(filePath, target, current);
      if (current === target ? !info.isFile() : !info.isDirectory()) {
        throw new Error(current === target
          ? `Client output ${filePath} must be a regular file.`
          : `Client output ${filePath} must be a regular file under ordinary directories: ${current} is not a directory.`);
      }
    } catch (error) {
      // Missing, or below a file: the ancestor that exists is checked next.
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== 'ENOENT' && code !== 'ENOTDIR') throw error;
    }
    const parent = path.dirname(current);
    if (parent === current) return;
    current = parent;
  }
}

/**
 * Name the link, and the same output without it, e.g. /tmp → /private/tmp on macOS.
 * The path is suggested only when the link resolves to what that position needs:
 * a directory above the output, a regular file at the output itself.
 */
async function throughLink(filePath: string, target: string, link: string): Promise<Error> {
  const message = link === target
    ? `Client output ${filePath} must be a regular file, not a symbolic link.`
    : `Client output ${filePath} must be a regular file under ordinary directories: ${link} is a symbolic link.`;
  try {
    const real = await realpath(link);
    const info = await stat(real);
    if (link === target ? !info.isFile() : !info.isDirectory()) return new Error(message);
    const resolved = path.join(real, path.relative(link, target));
    return new Error(`${message} Use the path it points to instead: ${resolved}`);
  } catch {
    return new Error(message);
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
  const at = error.field === undefined ? error.path : pointer(error.path, error.field);
  const where = at ? ` at ${at}` : '';
  const hint = error.code === 'HQ_CLIENT_UNKNOWN_FIELD'
    ? ' The contract may come from a newer hypequery than this CLI; upgrade @hypequery/cli.'
    : '';
  return new Error(`${error.message.replace(/\.$/, '')}${where} (${error.code}).${hint}`, { cause: error });
}
