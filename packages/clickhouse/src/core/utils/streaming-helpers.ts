import { Readable } from 'stream';

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

  const close = async () => {
    if (iterator && typeof iterator.return === 'function') {
      try {
        await iterator.return();
      } catch { }
    }
    if (typeof (nodeStream as Readable).destroy === 'function') {
      (nodeStream as Readable).destroy();
    }
  };

  return { readNext, close };
}

export function createJsonEachRowStream<T>(nodeStream: NodeJS.ReadableStream): ReadableStream<T[]> {
  const { flush, append } = createBufferFlusher<T>();

  let readerPromise: Promise<StreamReader>;

  const ensureReader = () => {
    if (!readerPromise) {
      readerPromise = createChunkReader(nodeStream);
    }
    return readerPromise;
  };

  return new ReadableStream<T[]>({
    async pull(controller) {
      const reader = await ensureReader();
      const { done, value } = await reader.readNext();

      if (done) {
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
    },
    async cancel() {
      const reader = await ensureReader();
      await reader.close();
    }
  });
}
