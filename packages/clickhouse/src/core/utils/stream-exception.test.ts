import { describe, expect, it } from 'vitest';
import { findUntaggedStreamException, splitStreamException } from './stream-exception.js';

const encoder = new TextEncoder();
const TAG = 'gtryiexlulqmrove';
const MESSAGE = 'Code: 395. DB::Exception: boom: while executing FUNCTION throwIf. (FUNCTION_THROW_IF_VALUE_IS_NON_ZERO) (version 26.6.2.20 (official build))';

// The block ClickHouse 25.11+ appends when a query fails after data was sent.
const block = (tag: string, message: string) =>
  `\r\n__exception__\r\n${tag}\r\n${message}\n${message.length + 1} ${tag}\r\n__exception__\r\n`;

const bytes = (...parts: (string | Uint8Array)[]) => {
  const chunks = parts.map(part => (typeof part === 'string' ? encoder.encode(part) : part));
  const joined = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0));
  let at = 0;
  for (const chunk of chunks) {
    joined.set(chunk, at);
    at += chunk.length;
  }
  return joined;
};

describe('splitStreamException', () => {
  it("separates the data that was sent from ClickHouse's error", () => {
    const data = new Uint8Array([0xff, 0xff, 0xff, 0xff, 0, 1, 2, 3]);
    const failure = splitStreamException(bytes(data, block(TAG, MESSAGE)), TAG);

    expect(failure).toBeDefined();
    expect(Array.from(failure!.data)).toEqual(Array.from(data));
    expect(failure!.error.message).toContain('boom');
    expect(failure!.error).toMatchObject({ code: '395', type: 'FUNCTION_THROW_IF_VALUE_IS_NON_ZERO' });
  });

  it('leaves a body that does not end in the exception block alone', () => {
    expect(splitStreamException(bytes('rows', block(TAG, MESSAGE), 'more rows'), TAG)).toBeUndefined();
    expect(splitStreamException(bytes('rows'), TAG)).toBeUndefined();
  });

  it("does not accept another response's tag", () => {
    expect(splitStreamException(bytes('rows', block('othertag12345678', MESSAGE)), TAG)).toBeUndefined();
  });

  it('still fails when the opening marker was not held', () => {
    const tail = block(TAG, MESSAGE).slice(40);
    const failure = splitStreamException(bytes(tail), TAG);

    expect(failure?.data.length).toBe(0);
    expect(failure?.error.message).toMatch(/failed mid-stream/);
  });
});

describe('findUntaggedStreamException', () => {
  it('splits the exception text a server before 25.11 appends from the data', () => {
    const data = new Uint8Array([0xff, 0xff, 0xff, 0xff, 0x80, 0xc3, 0x28]);
    const failure = findUntaggedStreamException(bytes(data, `${MESSAGE}\n`));

    expect(Array.from(failure!.data)).toEqual(Array.from(data));
    expect(failure!.error).toMatchObject({ code: '395', type: 'FUNCTION_THROW_IF_VALUE_IS_NON_ZERO' });
  });

  it('takes the last exception when the text appears more than once', () => {
    const failure = findUntaggedStreamException(bytes('a', MESSAGE, 'b', MESSAGE));

    expect(new TextDecoder().decode(failure!.data)).toBe(`a${MESSAGE}b`);
  });

  it('finds nothing in bytes without exception text', () => {
    expect(findUntaggedStreamException(bytes('rows'))).toBeUndefined();
  });
});
