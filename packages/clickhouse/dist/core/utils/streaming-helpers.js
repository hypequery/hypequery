import { Readable } from 'stream';
function createBufferFlusher() {
    let buffer = '';
    const flush = () => {
        if (!buffer.length) {
            return [];
        }
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';
        const rows = [];
        for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed.length) {
                continue;
            }
            rows.push(JSON.parse(trimmed));
        }
        return rows;
    };
    const append = (value) => {
        buffer += typeof value === 'string' ? value : value.toString('utf8');
    };
    return { flush, append };
}
async function normalizeChunk(chunk, flush, append) {
    if (chunk == null) {
        return [];
    }
    if (Array.isArray(chunk)) {
        const rows = [];
        for (const item of chunk) {
            rows.push(...await normalizeChunk(item, flush, append));
        }
        return rows;
    }
    if (typeof chunk.json === 'function') {
        return [await chunk.json()];
    }
    if (typeof chunk.text === 'function') {
        const text = await chunk.text();
        return [JSON.parse(text)];
    }
    if (typeof chunk.text === 'string') {
        return [JSON.parse(chunk.text)];
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
        return [chunk];
    }
    return [];
}
async function createChunkReader(nodeStream) {
    const iterator = nodeStream[Symbol.asyncIterator]?.();
    let webReader;
    const readNext = async () => {
        if (iterator) {
            const result = await iterator.next();
            return { done: Boolean(result.done), value: result.value };
        }
        if (!webReader) {
            const webStream = Readable.toWeb(nodeStream);
            webReader = webStream.getReader();
        }
        const result = await webReader.read();
        return { done: Boolean(result.done), value: result.value };
    };
    const close = async () => {
        if (iterator && typeof iterator.return === 'function') {
            try {
                await iterator.return();
            }
            catch { }
        }
        if (typeof nodeStream.destroy === 'function') {
            nodeStream.destroy();
        }
    };
    return { readNext, close };
}
async function createWebStreamReader(webStream) {
    const reader = webStream.getReader();
    const readNext = async () => {
        const result = await reader.read();
        return { done: Boolean(result.done), value: result.value };
    };
    const close = async () => {
        try {
            await reader.cancel();
        }
        catch { }
    };
    return { readNext, close };
}
export function createJsonEachRowStream(stream) {
    const { flush, append } = createBufferFlusher();
    let readerPromise;
    const ensureReader = () => {
        if (!readerPromise) {
            if (typeof stream?.getReader === 'function') {
                readerPromise = createWebStreamReader(stream);
            }
            else {
                readerPromise = createChunkReader(stream);
            }
        }
        return readerPromise;
    };
    return new ReadableStream({
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
            const rows = await normalizeChunk(value, flush, append);
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
