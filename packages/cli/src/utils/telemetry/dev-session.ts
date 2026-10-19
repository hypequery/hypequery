import type { DevOptions } from '../../commands/dev.js';
import { countBucket } from './buckets.js';
import { startCommandSession, type SessionEnd } from './command-context.js';
import { telemetryErrorCode } from './error-code.js';
import { devSessionConfig } from './session-config.js';
import type { ERROR_CODES } from './domains.js';

/** Counters only: no retained API, reload paths, errors, queries, or requests. */
export class DevSession {
  private reloads = 0;
  private reloadErrors = 0;
  private failures: Partial<Record<typeof ERROR_CODES[number], number>> = {};

  start(resolved: string, explicit: string | undefined, options: DevOptions): void {
    startCommandSession('dev', devSessionConfig(resolved, explicit, options), () => this.snapshot());
  }

  reload(): void { this.reloads++; }
  reloadFailed(): void { this.reloadErrors++; }

  loadFailed(error: unknown): typeof ERROR_CODES[number] {
    const code = telemetryErrorCode(error);
    const stable = code === 'unknown' ? 'load_error' : code;
    this.failures[stable] = (this.failures[stable] ?? 0) + 1;
    return stable;
  }

  snapshot(): SessionEnd<'dev'> {
    return { reload_count_bucket: countBucket(this.reloads)!, reload_error_count_bucket: countBucket(this.reloadErrors)!,
      load_failures: Object.fromEntries(Object.entries(this.failures).map(([code, count]) => [code, countBucket(count)])) };
  }
}
