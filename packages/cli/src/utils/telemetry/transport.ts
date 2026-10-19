import { validateTelemetryEvent } from './validation.js';
import { dispatchDetached, type DispatchBatch } from './detached-dispatch.js';
import { telemetryEndpoint } from './endpoint.js';

export const MAX_BATCH_BYTES = 64 * 1024;
export const MAX_BATCH_EVENTS = 32;

export interface TransportOptions {
  readonly enabled: boolean;
  readonly endpoint?: string;
  readonly debug?: boolean;
  /** Injectable for tests; defaults to a detached sender process. */
  readonly dispatch?: DispatchBatch;
  readonly write?: (text: string) => void;
  readonly now?: () => Date;
}

interface WireEvent {
  readonly event: string;
  readonly distinct_id: string;
  readonly properties: Record<string, unknown>;
  readonly timestamp: string;
}

/** In-memory, one-batch delivery with no retry queue and no vendor dependency. */
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
    const url = telemetryEndpoint(this.options.endpoint);
    if (!url) return;
    try {
      (this.options.dispatch ?? dispatchDetached)(url, JSON.stringify({ api_key: 'hypequery-cli', batch: events }));
    } catch { /* Temporary-file and spawn failures never affect the command. */ }
  }
}
