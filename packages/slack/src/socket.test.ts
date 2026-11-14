import { describe, expect, it, vi } from 'vitest';
import { createSocketModeClient, type SocketModeWebSocket } from './socket.js';
import { BOT, envelope } from './fixtures.test-utils.js';

class FakeSocket implements SocketModeWebSocket {
  static instances: FakeSocket[] = [];
  sent: string[] = [];
  closed = false;
  private listeners = new Map<string, Array<(event?: any) => void>>();

  constructor(readonly url: string) {
    FakeSocket.instances.push(this);
    queueMicrotask(() => this.emit('open'));
  }
  send(data: string) {
    this.sent.push(data);
  }
  close() {
    this.closed = true;
    this.emit('close');
  }
  addEventListener(type: string, listener: (event?: any) => void) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }
  emit(type: string, event?: unknown) {
    for (const listener of this.listeners.get(type) ?? []) listener(event);
  }
  receive(message: unknown) {
    this.emit('message', { data: JSON.stringify(message) });
  }
}

const openFetch = () =>
  vi.fn(async () => new Response(JSON.stringify({ ok: true, url: 'wss://example/socket' }), { status: 200 }));

describe('createSocketModeClient', () => {
  it('requires an app-level token', () => {
    expect(() => createSocketModeClient({ appToken: 'xoxb-1', WebSocket: FakeSocket })).toThrow(TypeError);
  });

  it('acks each envelope and dispatches events once', async () => {
    FakeSocket.instances = [];
    const onEvent = vi.fn();
    const client = createSocketModeClient({ appToken: 'xapp-1', WebSocket: FakeSocket, fetch: openFetch(), onEvent });
    await client.start();
    const socket = FakeSocket.instances[0]!;
    expect(socket.url).toBe('wss://example/socket');

    const payload = envelope({ type: 'app_mention', user: 'U1', channel: 'C1', ts: '1.0', text: `<@${BOT}> q` });
    socket.receive({ type: 'hello' });
    socket.receive({ type: 'events_api', envelope_id: 'env1', payload });
    socket.receive({ type: 'events_api', envelope_id: 'env2', payload, retry_attempt: 1, retry_reason: 'timeout' });
    await vi.waitFor(() => expect(socket.sent).toHaveLength(2));

    expect(socket.sent.map(s => JSON.parse(s))).toEqual([{ envelope_id: 'env1' }, { envelope_id: 'env2' }]);
    await vi.waitFor(() => expect(onEvent).toHaveBeenCalledTimes(1));
    expect(onEvent.mock.calls[0]![0]).toMatchObject({ kind: 'question', text: 'q' });
    client.stop();
  });

  it('reconnects after Slack asks it to disconnect, and not after stop()', async () => {
    vi.useFakeTimers();
    try {
      FakeSocket.instances = [];
      const statuses: string[] = [];
      const client = createSocketModeClient({
        appToken: 'xapp-1',
        WebSocket: FakeSocket,
        fetch: openFetch(),
        onStatus: s => statuses.push(s),
      });
      const started = client.start();
      await vi.runAllTicks();
      await vi.advanceTimersByTimeAsync(0);
      await started;

      FakeSocket.instances[0]!.receive({ type: 'disconnect', reason: 'refresh_requested' });
      expect(FakeSocket.instances[0]!.closed).toBe(true);
      await vi.advanceTimersByTimeAsync(1000);
      expect(FakeSocket.instances).toHaveLength(2);

      client.stop();
      await vi.advanceTimersByTimeAsync(60_000);
      expect(FakeSocket.instances).toHaveLength(2);
      expect(statuses).toEqual(['connecting', 'connected', 'reconnecting', 'connected', 'stopped']);
    } finally {
      vi.useRealTimers();
    }
  });
});
