import { Readable } from 'stream';
import { abortReason } from './abort.js';

type StreamReaderResult = { done: boolean; value?: any };

interface StreamReader {
  readNext(): Promise<StreamReaderResult>;
  close(): Promise<void>;
}

function createBufferFlusher<T>() {
  let buffer = '';

  const flush = (): T[] => {
    if (!buffer.length) {
      return [];
    }

    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';

    const rows: T[] = [];
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.length) {
        continue;
      }
      rows.push(JSON.parse(trimmed) as T);
    }

    return rows;
  };

  const append = (value: string | Buffer) => {
    buffer += typeof value === 'string' ? value : value.toString('utf8');
  };

  return { flush, append };
}

async function normalizeChunk<T>(chunk: any, flush: () => T[], append: (value: string | Buffer) => void): Promise<T[]> {
  if (chunk == null) {
    return [];
  }

  if (Array.isArray(chunk)) {
    const rows: T[] = [];
    for (const item of chunk) {
      rows.push(...await normalizeChunk<T>(item, flush, append));
    }
    return rows;
  }

  if (typeof chunk.json === 'function') {
    return [await chunk.json() as T];
  }

  if (typeof chunk.text === 'function') {
    const text = await chunk.text();
    return [JSON.parse(text) as T];
  }

  if (typeof chunk.text === 'string') {
    return [JSON.parse(chunk.text) as T];
  }

  if (Buffer.isBuffer(chunk)) {
    append(chunk);
    return flush();
  }

  if (chunk instanceof Uint8Array) {
    append(Buffer.from(chunk));
    return flush();
  }

  if (chunk instanceof ArrayBuffer) {
    append(Buffer.from(chunk));
    return flush();
  }

  if (typeof chunk === 'string') {
    append(chunk);
    return flush();
  }

  if (typeof chunk === 'object') {
    return [chunk as T];
  }

  return [];
}

async function createChunkReader(nodeStream: NodeJS.ReadableStream): Promise<StreamReader> {
  const iterator = nodeStream[Symbol.asyncIterator]?.();
  let webReader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  let closePromise: Promise<void> | undefined;

  const readNext = async () => {
    if (iterator) {
      const result = await iterator.next();
      return { done: Boolean(result.done), value: result.value } satisfies StreamReaderResult;
    }

    if (!webReader) {
      const webStream = Readable.toWeb(nodeStream as Readable) as ReadableStream<Uint8Array>;
      webReader = webStream.getReader();
    }

    const result = await webReader.read();
    return { done: Boolean(result.done), value: result.value } satisfies StreamReaderResult;
  };

  const close = () => {
    closePromise ??= (async () => {
      // A pending iterator.next() prevents iterator.return() from settling.
      // Destroy first so cancellation always releases the connection stream.
      if (typeof (nodeStream as Readable).destroy === 'function') {
        (nodeStream as Readable).destroy();
      }
      if (iterator && typeof iterator.return === 'function') {
        try {
          await iterator.return();
        } catch { }
      }
    })();
    return closePromise;
  };

  return { readNext, close };
}

async function createWebStreamReader<T>(webStream: ReadableStream<T>): Promise<StreamReader> {
  const reader = webStream.getReader();
  let closePromise: Promise<void> | undefined;

  const readNext = async () => {
    const result = await reader.read();
    return { done: Boolean(result.done), value: result.value } satisfies StreamReaderResult;
  };

  const close = () => {
    closePromise ??= (async () => {
      try {
        await reader.cancel();
      } catch { }
    })();
    return closePromise;
  };

  return { readNext, close };
}

export function createJsonEachRowStream<T>(
  stream: NodeJS.ReadableStream | ReadableStream<T[]>,
  abortSignal?: AbortSignal
): ReadableStream<T[]> {
  const { flush, append } = createBufferFlusher<T>();

  let readerPromise: Promise<StreamReader>;
  let onAbort: (() => void) | undefined;

  const ensureReader = () => {
    if (!readerPromise) {
      if (typeof (stream as ReadableStream<T[]> | undefined)?.getReader === 'function') {
        readerPromise = createWebStreamReader(stream as ReadableStream<T[]>);
      } else {
        readerPromise = createChunkReader(stream as NodeJS.ReadableStream);
      }
    }
    return readerPromise;
  };

  const detachAbort = () => {
    if (onAbort) {
      abortSignal?.removeEventListener('abort', onAbort);
      onAbort = undefined;
    }
  };

  return new ReadableStream<T[]>({
    start(controller) {
      if (!abortSignal) {
        return;
      }
      // The underlying clients stop honoring the signal once response headers
      // arrive, so aborting must both error the consumer and drop the source.
      const fail = () => {
        detachAbort();
        controller.error(abortReason(abortSignal));
        ensureReader().then(reader => reader.close()).catch(() => undefined);
      };
      if (abortSignal.aborted) {
        fail();
        return;
      }
      onAbort = fail;
      abortSignal.addEventListener('abort', onAbort, { once: true });
    },
    async pull(controller) {
      try {
        const reader = await ensureReader();
        const { done, value } = await reader.readNext();

        if (done) {
          detachAbort();
          const remaining = flush();
          if (remaining.length) {
            controller.enqueue(remaining);
          }
          controller.close();
          return;
        }

        const rows = await normalizeChunk<T>(value, flush, append);
        if (rows.length) {
          controller.enqueue(rows);
        }
      } catch (error) {
        detachAbort();
        const reader = await ensureReader();
        await reader.close();
        throw error;
      }
    },
    async cancel() {
      detachAbort();
      const reader = await ensureReader();
      await reader.close();
    }
  });
}
