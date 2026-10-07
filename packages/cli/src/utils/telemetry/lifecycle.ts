import type { TelemetryEvent } from './catalog.js';
import type { TelemetryCommand } from './domains.js';
import { durationBucket } from './buckets.js';
import { flagNames, knownCommand } from './flags.js';
import { TelemetryInvocation, type InvocationOptions } from './invocation.js';
import { CommandExit } from '../command-exit.js';
import { exceptionClass, telemetryErrorCode } from './error-code.js';
import type { CommandMetrics, SessionCommand, SessionStart, SessionEnd } from './command-context.js';
import type { ERROR_CODES } from './domains.js';

export class CommandLifecycle {
  private invocation?: TelemetryInvocation | null;
  private completed = false;
  private started = performance.now();
  private interrupted = false;
  private cancelled = false;
  private metrics: Record<string, unknown> = {};
  private errorCode?: typeof ERROR_CODES[number];
  private session?: { command: SessionCommand; started: number; end: () => object };
  command: TelemetryCommand = 'unknown';

  constructor(private readonly args: readonly string[], private readonly options: Omit<InvocationOptions, 'command'> = {}) {}

  async begin(command: string, database?: string): Promise<void> {
    this.command = knownCommand(command);
    if (this.invocation !== undefined) return;
    this.started = performance.now();
    this.invocation = await TelemetryInvocation.create({ ...this.options, command: this.command,
      contextOptions: { ...this.options.contextOptions, database } });
  }

  markInterrupted(): void { this.interrupted = true; }

  update<C extends TelemetryCommand>(command: C, metrics: CommandMetrics<C>): void {
    if (command !== this.command || this.completed) return;
    this.metrics = { ...this.metrics, ...Object.fromEntries(Object.entries(metrics).filter(([, value]) => value !== undefined)) };
  }

  cancel(): void { this.cancelled = true; }

  setError(code: typeof ERROR_CODES[number]): void { this.errorCode = code; }

  startSession<C extends SessionCommand>(command: C, start: SessionStart<C>, end: () => SessionEnd<C>): void {
    if (!this.invocation || this.completed || this.session || command !== this.command) return;
    this.invocation.record({ event: 'cli_session_started', properties: { ...this.invocation.common, ...start, command } } as TelemetryEvent);
    this.session = { command, started: performance.now(), end };
  }

  async finish(exit: CommandExit, helpTopic?: string): Promise<void> {
    if (this.completed) return;
    this.completed = true;
    if (!this.invocation) return;
    const outcome = this.interrupted ? 'interrupted' : this.cancelled && exit.outcome === 'success' ? 'cancelled' : exit.outcome;
    const errorCode = exit.errorCode && exit.errorCode !== 'unknown' ? exit.errorCode : this.errorCode ?? exit.errorCode;
    if (this.session) {
      try {
        this.invocation.record({ event: 'cli_session_ended', properties: {
          ...this.invocation.common, ...this.session.end(), command: this.session.command, outcome,
          duration_bucket: durationBucket(performance.now() - this.session.started)!,
        } } as TelemetryEvent);
      } catch { /* Broken optional counters must not suppress command completion. */ }
    }
    const properties = {
      ...this.invocation.common, ...this.metrics, command: this.command,
      flags_used: flagNames(this.command, this.args),
      outcome,
      duration_bucket: durationBucket(performance.now() - this.started)!,
      ...(errorCode && exit.outcome === 'failure' ? { error_code: errorCode } : exit.errorCode ? { error_code: exit.errorCode } : {}),
      ...(this.command === 'help' ? { help_topic: helpTopic ? knownCommand(helpTopic) : 'root' } : {}),
    };
    // Dynamic command discrimination is validated again by the transport.
    this.invocation.record({ event: 'cli_command_completed', properties } as TelemetryEvent);
    await this.invocation.flush();
  }

  /** Node retains its native fatal-error output/exit; delivery here is best-effort. */
  crash(error: unknown): void {
    try {
      if (!this.invocation || this.completed) return;
      this.invocation.record({ event: 'cli_crash', properties: { ...this.invocation.common,
        command: this.command, exception_class: exceptionClass(error), error_code: telemetryErrorCode(error) } });
      void this.finish(new CommandExit(1, 'failure', telemetryErrorCode(error))).catch(() => undefined);
    } catch { /* Preserve Node's original fatal error even for hostile thrown objects. */ }
  }
}
