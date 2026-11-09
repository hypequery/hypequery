import { describe, expect, it, vi } from 'vitest';
import { Readable } from 'stream';
import { createByteStream } from './byte-stream.js';
import { EXCEPTION_BLOCK_MAX_BYTES } from './stream-exception.js';

const TAG = 'abcdefghijklmnop';
const MESSAGE = 'Code: 395. DB::Exception: boom. (FUNCTION_THROW_IF_VALUE_IS_NON_ZERO)';
const block = `\r\n__exception__\r\n${TAG}\r\n${MESSAGE}\n${MESSAGE.length + 1} ${TAG}\r\n__exception__\r\n`;

async function drain(stream: ReadableStream<Uint8Array>) {
  const chunks: Uint8Array[] = [];
  const reader = stream.getReader();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) return { bytes: join(chunks), chunks };
      chunks.push(value);
    }
  } catch (error) {
    return { bytes: join(chunks), chunks, error: error as Error };
  }
}

function join(chunks: Uint8Array[]) {
  return Buffer.concat(chunks.map(chunk => Buffer.from(chunk)));
}

const payload = (size: number) => Buffer.alloc(size, 7);
const END = Buffer.from([0xff, 0xff, 0xff, 0xff, 0, 0, 0, 0]);

describe('createByteStream', () => {
  it('passes bytes through unchanged without an exception tag', async () => {
    const source = Readable.from([payload(10), payload(20)]);
    const { bytes, chunks, error } = await drain(createByteStream(source));

    expect(error).toBeUndefined();
    expect(bytes).toEqual(payload(30));
    expect(chunks).toHaveLength(2);
  });

  it('reads web streams too', async () => {
    const source = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array([1, 2]));
        controller.enqueue(new Uint8Array([3]));
        controller.close();
      },
    });
    const { bytes } = await drain(createByteStream(source));
    expect(Array.from(bytes)).toEqual([1, 2, 3]);
  });

  it('releases all but the held tail as data arrives, and the tail at the end', async () => {
    const first = payload(EXCEPTION_BLOCK_MAX_BYTES + 100);
    const source = Readable.from([first, payload(50)]);
    const { bytes, chunks, error } = await drain(createByteStream(source, { exceptionTag: TAG }));

    expect(error).toBeUndefined();
    expect(bytes).toEqual(payload(EXCEPTION_BLOCK_MAX_BYTES + 150));
    expect(chunks[0]!.length).toBe(100);
  });

  it("fails with ClickHouse's error after delivering the data sent before it", async () => {
    const source = Readable.from([payload(EXCEPTION_BLOCK_MAX_BYTES * 2), Buffer.from(block)]);
    const { bytes, error } = await drain(createByteStream(source, { exceptionTag: TAG }));

    expect(bytes).toEqual(payload(EXCEPTION_BLOCK_MAX_BYTES * 2));
    expect(error?.message).toContain('boom');
    expect(error).toMatchObject({ code: '395' });
  });

  it("prefers ClickHouse's error when the connection resets after the exception block", async () => {
    const source = new Readable({ read() { /* driven below */ } });
    source.push(payload(5));
    source.push(Buffer.from(block));
    setImmediate(() => source.destroy(Object.assign(new Error('aborted'), { code: 'ECONNRESET' })));
    const { bytes, error } = await drain(createByteStream(source, { exceptionTag: TAG }));

    expect(bytes).toEqual(payload(5));
    expect(error?.message).toContain('boom');
  });

  it('keeps a plain read error when no exception block was sent', async () => {
    const source = new Readable({ read() { /* driven below */ } });
    source.push(payload(5));
    setImmediate(() => source.destroy(new Error('socket hang up')));
    const { error } = await drain(createByteStream(source, { exceptionTag: TAG }));

    expect(error?.message).toBe('socket hang up');
  });

  it('fails when the exception block is split across chunks', async () => {
    const source = Readable.from([payload(5), Buffer.from(block.slice(0, 20)), Buffer.from(block.slice(20))]);
    const { bytes, error } = await drain(createByteStream(source, { exceptionTag: TAG }));

    expect(bytes).toEqual(payload(5));
    expect(error?.message).toContain('boom');
  });

  it('passes a body that ends with the end marker', async () => {
    const source = Readable.from([payload(EXCEPTION_BLOCK_MAX_BYTES), payload(10), END]);
    const { bytes, error } = await drain(createByteStream(source, { endMarker: END }));

    expect(error).toBeUndefined();
    expect(bytes).toEqual(Buffer.concat([payload(EXCEPTION_BLOCK_MAX_BYTES + 10), END]));
  });

  it('fails a body that ends without the end marker, after its data', async () => {
    const source = Readable.from([payload(5)]);
    const { bytes, error } = await drain(createByteStream(source, { endMarker: END }));

    expect(bytes).toEqual(payload(5));
    expect(error?.message).toMatch(/result is incomplete.*before 25\.11/);
  });

  it('checks the end marker when a tagged body has no exception block', async () => {
    const source = Readable.from([payload(5)]);
    const { error } = await drain(createByteStream(source, { exceptionTag: TAG, endMarker: END }));

    expect(error?.message).toContain('result is incomplete');
  });

  it("recovers ClickHouse's error from untagged exception text before 25.11", async () => {
    const source = Readable.from([payload(5), Buffer.from(`${MESSAGE}\n`)]);
    const { bytes, error } = await drain(createByteStream(source, { endMarker: END }));

    expect(bytes).toEqual(payload(5));
    expect(error).toMatchObject({ code: '395' });
  });

  it("prefers untagged exception text over the socket error when the connection resets", async () => {
    const source = new Readable({ read() { /* driven below */ } });
    source.push(payload(5));
    source.push(Buffer.from(MESSAGE));
    setImmediate(() => source.destroy(Object.assign(new Error('aborted'), { code: 'ECONNRESET' })));
    const { error } = await drain(createByteStream(source, { endMarker: END }));

    expect(error?.message).toContain('boom');
  });

  it('passes a complete body whose data contains exception-like text', async () => {
    const source = Readable.from([Buffer.from(MESSAGE), END]);
    const { error } = await drain(createByteStream(source, { endMarker: END }));

    expect(error).toBeUndefined();
  });

  it('ignores exception-like text without an end marker to check against', async () => {
    const source = Readable.from([Buffer.from(MESSAGE)]);
    const { bytes, error } = await drain(createByteStream(source));

    expect(error).toBeUndefined();
    expect(bytes.toString()).toBe(MESSAGE);
  });

  it('errors the consumer and destroys the source on abort', async () => {
    const controller = new AbortController();
    const source = new Readable({ read() { /* stays open */ } });
    source.push(payload(10));
    const stream = createByteStream(source, { abortSignal: controller.signal });
    const reader = stream.getReader();
    expect((await reader.read()).value?.length).toBe(10);

    controller.abort(new Error('caller went away'));

    await expect(reader.read()).rejects.toThrow('caller went away');
    await vi.waitFor(() => expect(source.destroyed).toBe(true));
  });

  it('destroys the source when the consumer cancels', async () => {
    const source = new Readable({ read() { /* stays open */ } });
    source.push(payload(10));
    const reader = createByteStream(source).getReader();
    await reader.read();

    await reader.cancel();

    expect(source.destroyed).toBe(true);
  });
});
