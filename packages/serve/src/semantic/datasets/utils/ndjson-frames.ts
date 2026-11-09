/**
 * A streamed dataset response as NDJSON frames, one JSON object per line:
 *
 *   {"type":"start","meta":{...}}       meta only when requested
 *   {"type":"rows","data":[...]}        one per batch, as `execute` returns rows
 *   {"type":"end","rowCount":N}         the result is complete
 *   {"type":"error","error":{...}}      the query failed after the response began
 *
 * The HTTP status is sent before the first row, so a failure partway is a
 * final `error` frame; a response without an `end` frame is incomplete. The
 * client only sees a sanitized message: `failure()` returns the error itself,
 * once the stream has ended, for hooks and logs.
 */
export function datasetNdjsonStream(
  rows: ReadableStream<Record<string, unknown>[]>,
  meta?: unknown,
): { stream: ReadableStream<Uint8Array>; failure: () => unknown } {
  const encoder = new TextEncoder();
  const frame = (value: unknown) => encoder.encode(`${JSON.stringify(value)}\n`);
  const reader = rows.getReader();
  let rowCount = 0;
  let failure: unknown;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(frame(meta === undefined ? { type: 'start' } : { type: 'start', meta }));
    },
    async pull(controller) {
      try {
        // A pull that enqueues nothing is not called again: skip empty batches here.
        for (;;) {
          const { done, value } = await reader.read();
          if (done) {
            controller.enqueue(frame({ type: 'end', rowCount }));
            controller.close();
            return;
          }
          if (value.length === 0) continue;
          rowCount += value.length;
          controller.enqueue(frame({ type: 'rows', data: value }));
          return;
        }
      } catch (error) {
        failure = error ?? new Error('The row stream failed without an error.');
        // Never the thrown message: it can carry SQL or a driver detail.
        controller.enqueue(frame({
          type: 'error',
          error: { type: 'QUERY_FAILURE', message: 'The query failed after the response began.' },
        }));
        controller.close();
      }
    },
    cancel(reason) {
      return reader.cancel(reason);
    },
  });
  return { stream, failure: () => failure };
}
