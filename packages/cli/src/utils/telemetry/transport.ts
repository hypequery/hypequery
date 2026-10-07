import { validateTelemetryEvent } from './validation.js';

export const MAX_BATCH_BYTES = 64 * 1024;
export const MAX_BATCH_EVENTS = 32;
export const FLUSH_TIMEOUT_MS = 40;

export interface TransportOptions {
  readonly enabled: boolean;
  readonly endpoint?: string;
  readonly debug?: boolean;
  readonly fetch?: typeof globalThis.fetch;
  readonly write?: (text: string) => void;
  readonly onDisabled?: () => Promise<unknown>;
  readonly now?: () => Date;
}

interface WireEvent {
  readonly event: string;
  readonly distinct_id: string;
  readonly properties: Record<string, unknown>;
  readonly timestamp: string;
}

/** In-memory, one-request delivery with no retry queue and no vendor dependency. */
export class TelemetryTransport {
  private queue: WireEvent[] = [];
  private sent = false;
  private flushing?: Promise<void>;

  constructor(private readonly options: TransportOptions) {}

  private debug(text: string): void {
    try { (this.options.write ?? (message => { process.stderr.write(message); }))(text); } catch { /* Ignore broken stderr. */ }
  }

  enqueue(input: unknown): void {
    if (!this.options.enabled || this.sent || this.queue.length >= MAX_BATCH_EVENTS) return;
    try {
      if (!validateTelemetryEvent(input)) {
        if (this.options.debug) this.debug('[telemetry] Dropped invalid event.\n');
        return;
      }
      const snapshot: unknown = JSON.parse(JSON.stringify(input));
      if (!validateTelemetryEvent(snapshot)) {
        if (this.options.debug) this.debug('[telemetry] Dropped invalid event.\n');
        return;
      }
      const event: WireEvent = {
        event: snapshot.event, distinct_id: snapshot.properties.install_id,
        properties: { ...snapshot.properties, $process_person_profile: false, $geoip_disable: true },
        timestamp: (this.options.now?.() ?? new Date()).toISOString(),
      };
      if (Buffer.byteLength(JSON.stringify({ api_key: 'hypequery-cli', batch: [...this.queue, event] })) > MAX_BATCH_BYTES) {
        if (this.options.debug) this.debug('[telemetry] Dropped event: batch size limit.\n');
        return;
      }
      this.queue.push(event);
    } catch {
      if (this.options.debug) this.debug('[telemetry] Dropped invalid event.\n');
    }
  }

  flush(): Promise<void> {
    this.flushing ??= this.send();
    return this.flushing;
  }

  private async send(): Promise<void> {
    this.sent = true;
    const events = this.queue;
    this.queue = [];
    if (!this.options.enabled || !events.length) return;
    if (this.options.debug) {
      for (const event of events) this.debug(`${JSON.stringify(event)}\n`);
      return;
    }
    if (!this.options.endpoint) return;
    let timer: NodeJS.Timeout | undefined;
    const controller = new AbortController();
    try {
      const url = new URL(this.options.endpoint);
      const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
      if ((url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback)) || url.username || url.password || url.search || url.hash) return;
      const fetcher = this.options.fetch ?? globalThis.fetch;
      if (typeof fetcher !== 'function') return;
      const timeout = new Promise<void>(resolve => {
        timer = setTimeout(() => { controller.abort(); resolve(); }, FLUSH_TIMEOUT_MS);
        timer.unref();
      });
      const request = (async () => {
        const response = await fetcher(url, {
          method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ api_key: 'hypequery-cli', batch: events }),
          signal: controller.signal, redirect: 'error',
        });
        // The proxy owns the real PostHog API key. 410 disables this CLI version.
        if (response.status === 410 && !controller.signal.aborted) await this.options.onDisabled?.();
        await response.body?.cancel();
      })().catch(() => undefined);
      await Promise.race([request, timeout]);
    } catch { /* DNS/TLS/HTTP/abort/synchronous failures never affect the command. */ }
    finally { if (timer) clearTimeout(timer); controller.abort(); }
  }
}
