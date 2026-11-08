import { parseError } from '@clickhouse/client-common';

/**
 * The header ClickHouse (25.11+) sends before any data, naming the tag it will
 * wrap a mid-stream exception in.
 */
export const EXCEPTION_TAG_HEADER = 'x-clickhouse-exception-tag';

/**
 * Upper bound on the exception block a byte stream holds back. ClickHouse's
 * messages are a few hundred bytes; a longer one still fails the stream, only
 * without its text.
 */
export const EXCEPTION_BLOCK_MAX_BYTES = 16 * 1024;

/** The start of the exception text servers before 25.11 append to a failed body. */
const UNTAGGED_EXCEPTION_RE = /Code: \d+\. DB::Exception: /g;

const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8');

export interface StreamException {
  /** The bytes before the exception block: the part of the result that was sent. */
  data: Uint8Array;
  error: Error;
}

/**
 * Splits a failed response's trailing exception block from the data before it.
 *
 * ClickHouse cannot change the status once data has been sent, so it ends the
 * body with:
 *
 *   \r\n__exception__\r\n<tag>\r\n<message>\n<length> <tag>\r\n__exception__\r\n
 *
 * Returns `undefined` when `bytes` does not end that way, so a body that merely
 * contains the marker is never mistaken for a failure.
 */
export function splitStreamException(
  bytes: Uint8Array,
  tag: string,
): StreamException | undefined {
  const end = encoder.encode(` ${tag}\r\n__exception__\r\n`);
  if (!endsWith(bytes, end)) {
    return undefined;
  }

  const start = encoder.encode(`\r\n__exception__\r\n${tag}\r\n`);
  const startAt = lastIndexOf(bytes, start);
  if (startAt < 0) {
    return {
      data: new Uint8Array(0),
      error: new Error('ClickHouse failed mid-stream; its error message was too long to recover.'),
    };
  }

  // "<message>\n<length>": the length hint follows the message's last newline.
  const body = decoder.decode(bytes.subarray(startAt + start.length, bytes.length - end.length));
  const hintAt = body.lastIndexOf('\n');
  const message = (hintAt >= 0 ? body.slice(0, hintAt) : body).trim();
  return { data: bytes.subarray(0, startAt), error: parseError(message) };
}

/**
 * Finds the plain exception text a ClickHouse server older than 25.11 appends
 * when a query fails after data was sent. Those servers mark nothing, so this
 * is only meaningful once the body is already known to be incomplete: binary
 * data could contain the same text by chance.
 */
export function findUntaggedStreamException(bytes: Uint8Array): StreamException | undefined {
  // windows-1252 decodes one character per byte, so indices stay byte offsets.
  const text = new TextDecoder('windows-1252').decode(bytes);
  let startAt = -1;
  for (const match of text.matchAll(UNTAGGED_EXCEPTION_RE)) startAt = match.index;
  if (startAt < 0) return undefined;

  const message = decoder.decode(bytes.subarray(startAt)).trim();
  return { data: bytes.subarray(0, startAt), error: parseError(message) };
}

export function endsWith(bytes: Uint8Array, suffix: Uint8Array): boolean {
  if (bytes.length < suffix.length) return false;
  const offset = bytes.length - suffix.length;
  for (let i = 0; i < suffix.length; i++) {
    if (bytes[offset + i] !== suffix[i]) return false;
  }
  return true;
}

function lastIndexOf(bytes: Uint8Array, needle: Uint8Array): number {
  outer: for (let at = bytes.length - needle.length; at >= 0; at--) {
    for (let i = 0; i < needle.length; i++) {
      if (bytes[at + i] !== needle[i]) continue outer;
    }
    return at;
  }
  return -1;
}
