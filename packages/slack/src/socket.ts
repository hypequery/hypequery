/**
 * Socket Mode: receive events over a WebSocket the app opens, so a bot can
 * run behind a firewall or on a laptop with no public Request URL. Needs an
 * app-level token (`xapp-`) with the `connections:write` scope.
 *
 * https://api.slack.com/apis/socket-mode
 */

import { createSlackClient, type SlackFetch } from './api.js';
import { createSlackDispatcher, type SlackHandlers } from './dispatch.js';
import type { SlackEventEnvelope, SlackRequestBody, SlackSlashCommand } from './events.js';

/** The parts of a WebSocket used here; the global `WebSocket` (Node.js 22+) or the `ws` package both fit. */
export interface SocketModeWebSocket {
  send(data: string): void;
  close(code?: number, reason?: string): void;
  addEventListener(type: 'open' | 'close' | 'error', listener: () => void): void;
  addEventListener(type: 'message', listener: (event: { data: unknown }) => void): void;
}

export type SocketModeWebSocketConstructor = new (url: string) => SocketModeWebSocket;

export type SocketModeStatus = 'connecting' | 'connected' | 'reconnecting' | 'stopped';

export interface SocketModeOptions extends SlackHandlers {
  /** App-level token (`xapp-`), Basic Information → App-Level Tokens. */
  appToken: string;
  /** @default globalThis.WebSocket (Node.js 22+). On Node.js 20, pass `WebSocket` from the `ws` package. */
  WebSocket?: SocketModeWebSocketConstructor;
  fetch?: SlackFetch;
  onStatus?: (status: SocketModeStatus) => void;
  /** Longest wait between reconnect attempts. @default 30000 */
  maxBackoffMs?: number;
}

export interface SocketModeClient {
  /** Resolves once the first connection is open. */
  start(): Promise<void>;
  stop(): void;
}

interface SocketEnvelope {
  type: string;
  envelope_id?: string;
  payload?: unknown;
  retry_attempt?: number;
  retry_reason?: string;
  reason?: string;
}

export function createSocketModeClient(options: SocketModeOptions): SocketModeClient {
  if (!options.appToken?.startsWith('xapp-')) {
    throw new TypeError('createSocketModeClient: appToken must be an app-level token (xapp-…)');
  }
  const WebSocketImpl = options.WebSocket ?? (globalThis as { WebSocket?: SocketModeWebSocketConstructor }).WebSocket;
  if (!WebSocketImpl) {
    throw new TypeError('createSocketModeClient: no global WebSocket; pass `WebSocket` from the `ws` package');
  }
  const api = createSlackClient({ token: options.appToken, fetch: options.fetch });
  const dispatch = createSlackDispatcher(options);
  const maxBackoffMs = options.maxBackoffMs ?? 30_000;
  const onError = options.onError ?? ((error: unknown) => console.error('[hypequery/slack]', error));

  let stopped = false;
  let socket: SocketModeWebSocket | null = null;
  let failures = 0;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  const status = (value: SocketModeStatus) => options.onStatus?.(value);

  async function connect(): Promise<void> {
    const { url } = await api.call<{ url: string }>('apps.connections.open');
    if (stopped) return;

    await new Promise<void>((resolve, reject) => {
      const ws = new WebSocketImpl!(url);
      let opened = false;
      socket = ws;

      ws.addEventListener('open', () => {
        opened = true;
        failures = 0;
        status('connected');
        resolve();
      });
      ws.addEventListener('error', () => {
        if (!opened) reject(new Error('Socket Mode connection failed'));
      });
      ws.addEventListener('close', () => {
        if (socket === ws) socket = null;
        if (!opened) reject(new Error('Socket Mode connection closed before opening'));
        else scheduleReconnect();
      });
      ws.addEventListener('message', event => {
        void handleMessage(ws, event.data);
      });
    });
  }

  async function handleMessage(ws: SocketModeWebSocket, data: unknown): Promise<void> {
    let message: SocketEnvelope;
    try {
      message = JSON.parse(typeof data === 'string' ? data : String(data)) as SocketEnvelope;
    } catch {
      return;
    }

    if (message.type === 'disconnect') {
      // Slack is about to drop this connection (refresh or server move). Close it and open a new one.
      ws.close(1000, message.reason ?? 'disconnect');
      return;
    }

    // Ack first, always: Slack resends anything not acked within 3 seconds.
    if (message.envelope_id) ws.send(JSON.stringify({ envelope_id: message.envelope_id }));

    const body = toRequestBody(message);
    if (!body) return;
    const retry = message.retry_attempt ? { attempt: message.retry_attempt, reason: message.retry_reason ?? null } : null;
    try {
      const work = await dispatch(body, retry);
      if (work) await work();
    } catch (error) {
      onError(error, {});
    }
  }

  function scheduleReconnect(): void {
    if (stopped || reconnectTimer) return;
    status('reconnecting');
    const delay = Math.min(maxBackoffMs, 500 * 2 ** failures) * (0.5 + Math.random() / 2);
    failures++;
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      connect().catch(error => {
        onError(error, {});
        scheduleReconnect();
      });
    }, delay);
  }

  return {
    async start() {
      stopped = false;
      status('connecting');
      await connect();
    },
    stop() {
      stopped = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      reconnectTimer = null;
      socket?.close(1000, 'stopped');
      socket = null;
      status('stopped');
    },
  };
}

function toRequestBody(message: SocketEnvelope): SlackRequestBody | null {
  const payload = message.payload;
  if (typeof payload !== 'object' || payload === null) return null;
  switch (message.type) {
    case 'events_api': {
      const envelope = payload as SlackEventEnvelope;
      return envelope.type === 'event_callback' && typeof envelope.event_id === 'string' ? { type: 'event', envelope } : null;
    }
    case 'interactive':
      return { type: 'interaction', payload: payload as Record<string, unknown> };
    case 'slash_commands':
      return { type: 'command', command: payload as SlackSlashCommand };
    default:
      return null;
  }
}
