import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import * as path from 'node:path';

/**
 * Anonymous usage telemetry for the hypequery playground.
 *
 * Privacy rules (enforced here, documented in plans/dev-playground-design.md):
 * - NEVER captures SQL, query/endpoint names (hashed only), inputs, results,
 *   hostnames, file paths, or credentials.
 * - Anonymous machine id (random UUID) + hashed project id; no PII.
 * - Loud one-time disclosure on first enabled run.
 * - Opt-out: `hypequery dev --no-telemetry`, HYPEQUERY_TELEMETRY_DISABLED=1, or
 *   DO_NOT_TRACK=1; auto-disabled in CI; entirely inert until an ingest
 *   endpoint is configured.
 * - Fire-and-forget: batched, 3s timeout, all failures swallowed. Telemetry
 *   must never slow down or break the dev server.
 */

/**
 * Ingest endpoint for telemetry events. Empty string = telemetry is a no-op.
 * Overridable via HYPEQUERY_TELEMETRY_ENDPOINT (useful for self-hosting).
 */
const DEFAULT_ENDPOINT = '';

const STATE_FILE = path.join(homedir(), '.hypequery', 'telemetry.json');
const FLUSH_INTERVAL_MS = 5_000;
const FLUSH_BATCH_SIZE = 20;
const REQUEST_TIMEOUT_MS = 3_000;

/**
 * UI events accepted through the /__dev/telemetry beacon (allowlist).
 * Keep this in lockstep with the events the studio actually fires — anything
 * absent is silently dropped by the gateway. Add a name only when a matching
 * `track(...)` call ships in the UI, not speculatively.
 */
export const UI_EVENT_ALLOWLIST = new Set([
  'screen_viewed',
  'sql_viewed',
  'search_used',
  'execute_clicked',
  'history_cleared_clicked',
]);

export interface TelemetryEvent {
  name: string;
  props?: Record<string, string | number | boolean>;
}

interface TelemetryState {
  anonymousId: string;
  notifiedAt?: string;
}

export interface TelemetryOptions {
  /** Project directory used to derive the hashed project id. */
  projectDir?: string;
  /** Logger used for the one-time disclosure notice. */
  logger?: (message: string) => void;
  /** Override the ingest endpoint (tests). */
  endpoint?: string;
  /** Override fetch (tests). */
  fetchFn?: typeof fetch;
  /** Override the anonymous-id state file location (tests / self-hosting). */
  stateFile?: string;
  /**
   * Hard opt-out that overrides every enabling signal, including a configured
   * endpoint. Wired to `hypequery dev --no-telemetry`.
   */
  disabled?: boolean;
}

function isTruthyEnv(value: string | undefined): boolean {
  return value === '1' || value === 'true' || value === 'yes';
}

/** Stable short hash for values we want to count but never read. */
export function anonymize(value: string): string {
  return createHash('sha256').update(value).digest('hex').slice(0, 12);
}

/** Bucket a duration so we never ship exact timings. */
export function durationBucket(ms: number): string {
  if (ms < 50) return '<50ms';
  if (ms < 250) return '<250ms';
  if (ms < 1_000) return '<1s';
  if (ms < 5_000) return '<5s';
  if (ms < 30_000) return '<30s';
  return '>=30s';
}

export class Telemetry {
  private queue: Array<TelemetryEvent & { timestamp: number }> = [];
  private flushTimer: NodeJS.Timeout | null = null;
  private state: TelemetryState | null = null;
  private projectId: string;
  private readonly endpoint: string;
  private readonly fetchFn: typeof fetch;
  private readonly logger: (message: string) => void;
  private readonly forceDisabled: boolean;
  private readonly stateFile: string;
  private pendingSends: Set<Promise<void>> = new Set();
  private initPromise: Promise<void> | null = null;

  constructor(options: TelemetryOptions = {}) {
    this.endpoint =
      options.endpoint ??
      process.env.HYPEQUERY_TELEMETRY_ENDPOINT ??
      DEFAULT_ENDPOINT;
    this.fetchFn = options.fetchFn ?? fetch;
    this.logger = options.logger ?? ((message) => console.log(message));
    this.projectId = anonymize(options.projectDir ?? process.cwd());
    this.forceDisabled = options.disabled ?? false;
    this.stateFile = options.stateFile ?? STATE_FILE;
  }

  /** Telemetry is enabled only with an endpoint and no opt-out signals. */
  get enabled(): boolean {
    if (this.forceDisabled) return false;
    if (!this.endpoint) return false;
    if (isTruthyEnv(process.env.HYPEQUERY_TELEMETRY_DISABLED)) return false;
    if (isTruthyEnv(process.env.DO_NOT_TRACK)) return false;
    if (isTruthyEnv(process.env.CI)) return false;
    return true;
  }

  /**
   * Load (or create) the anonymous id and print the one-time disclosure.
   * Safe to call when disabled — it is then a no-op — and idempotent: repeated
   * or concurrent calls resolve the same one-time load.
   */
  async initialize(): Promise<void> {
    if (!this.enabled || this.state) return;
    this.initPromise ??= this.loadState();
    return this.initPromise;
  }

  private async loadState(): Promise<void> {
    try {
      const raw = await readFile(this.stateFile, 'utf-8');
      this.state = JSON.parse(raw) as TelemetryState;
    } catch {
      this.state = { anonymousId: randomUUID() };
    }

    if (!this.state.notifiedAt) {
      this.logger(
        '[hypequery] Anonymous usage telemetry helps improve the playground. ' +
          'No queries, schemas, or data are ever collected. ' +
          'Opt out any time: HYPEQUERY_TELEMETRY_DISABLED=1 ' +
          '(details: https://hypequery.com/telemetry)'
      );
      this.state.notifiedAt = new Date().toISOString();
    }

    try {
      await mkdir(path.dirname(this.stateFile), { recursive: true });
      await writeFile(this.stateFile, JSON.stringify(this.state, null, 2));
    } catch {
      // Non-fatal: id will be regenerated next run.
    }
  }

  /** Record an event. No-op when disabled. */
  track(name: string, props?: TelemetryEvent['props']): void {
    if (!this.enabled) return;
    // Safety net: if a caller tracks before initialize(), kick it off now so
    // the anonymous id is loaded and the disclosure prints before the flush.
    if (!this.state) void this.initialize();
    this.queue.push({ name, props, timestamp: Date.now() });
    if (this.queue.length >= FLUSH_BATCH_SIZE) {
      void this.flush();
    } else {
      this.scheduleFlush();
    }
  }

  private scheduleFlush(): void {
    if (this.flushTimer) return;
    this.flushTimer = setTimeout(() => {
      void this.flush();
    }, FLUSH_INTERVAL_MS);
    this.flushTimer.unref?.();
  }

  /** Send queued events. All failures are swallowed. */
  async flush(): Promise<void> {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
    if (!this.enabled || this.queue.length === 0) return;

    const events = this.queue.splice(0, this.queue.length);
    const body = JSON.stringify({
      anonymousId: this.state?.anonymousId ?? 'uninitialized',
      projectId: this.projectId,
      context: {
        nodeMajor: Number(process.versions.node.split('.')[0]),
        platform: process.platform,
      },
      events,
    });

    const send = (async () => {
      try {
        await this.fetchFn(this.endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body,
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        });
      } catch {
        // Telemetry must never surface errors.
      }
    })();
    this.pendingSends.add(send);
    void send.finally(() => this.pendingSends.delete(send));
    await send;
  }

  /** Flush remaining events and stop timers. */
  async shutdown(): Promise<void> {
    await this.flush();
    await Promise.allSettled([...this.pendingSends]);
  }
}
