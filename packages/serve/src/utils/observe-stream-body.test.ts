import { describe, expect, it, vi } from 'vitest';
import { observeStreamBody, type StreamSettlement } from './observe-stream-body.js';
import { streamBody } from './stream-body.js';
import { StreamTimeoutError } from './stream-timeout.js';

const chunks = (...sizes: number[]) => new ReadableStream<Uint8Array>({
  start(controller) {
    for (const size of sizes) controller.enqueue(new Uint8Array(size));
    controller.close();
  },
});

describe('observeStreamBody', () => {
  it('settles once, as completed, before the reader sees the end', async () => {
    const order: string[] = [];
    const observed = observeStreamBody(streamBody(chunks(2, 3), 'application/x-test'), (settlement) => {
      order.push(`settled:${settlement.outcome}:${settlement.bytes}`);
    });
    expect(observed.contentType).toBe('application/x-test');
    const reader = observed.stream.getReader();
    for (;;) {
      const { done } = await reader.read();
      if (done) break;
    }
    order.push('done');
    expect(order).toEqual(['settled:completed:5', 'done']);
  });

  it('reports a failure the body absorbed in-band', async () => {
    const absorbed = new Error('absorbed');
    const onSettled = vi.fn<(settlement: StreamSettlement) => void>();
    const observed = observeStreamBody(
      streamBody(chunks(1), 'application/x-test', { failure: () => absorbed }),
      onSettled,
    );
    await new Response(observed.stream).arrayBuffer();
    expect(onSettled).toHaveBeenCalledWith({ outcome: 'failed', bytes: 1, error: absorbed });
  });

  it('reports an erroring stream and passes the error on', async () => {
    const onSettled = vi.fn<(settlement: StreamSettlement) => void>();
    const broken = new ReadableStream<Uint8Array>({ pull(controller) { controller.error(new Error('boom')); } });
    const observed = observeStreamBody(streamBody(broken, 'application/x-test'), onSettled);
    await expect(new Response(observed.stream).arrayBuffer()).rejects.toThrow('boom');
    expect(onSettled).toHaveBeenCalledTimes(1);
    expect(onSettled.mock.calls[0]![0]).toMatchObject({ outcome: 'failed', bytes: 0 });
  });

  it('reports a cancellation, or a timeout cancellation as a failure, and cancels the source', async () => {
    for (const [reason, outcome] of [[undefined, 'cancelled'], [new StreamTimeoutError('idle', 10), 'failed']] as const) {
      let sourceReason: unknown = 'not cancelled';
      const source = new ReadableStream<Uint8Array>({ cancel(why) { sourceReason = why; } });
      const onSettled = vi.fn<(settlement: StreamSettlement) => void>();
      const observed = observeStreamBody(streamBody(source, 'application/x-test'), onSettled);
      await observed.stream.cancel(reason);
      expect(sourceReason).toBe(reason);
      expect(onSettled).toHaveBeenCalledTimes(1);
      expect(onSettled.mock.calls[0]![0].outcome).toBe(outcome);
    }
  });

  it('survives a reporter that throws', async () => {
    const observed = observeStreamBody(streamBody(chunks(1), 'application/x-test'), () => {
      throw new Error('hook broke');
    });
    expect((await new Response(observed.stream).arrayBuffer()).byteLength).toBe(1);
  });
});
