import { isCliError } from './cli-error.js';
import { EXIT_CODES, type ExitClass } from './exit-codes.js';

/**
 * `--json`: stdout carries exactly one JSON document, the command's result or
 * the error envelope, and everything a person would read goes to stderr.
 * Scripts and coding agents parse stdout and branch on the exit code.
 */
export interface ErrorEnvelope {
  readonly error: {
    readonly code: string;
    readonly message: string;
    readonly hint?: string;
    readonly category: 'correctable_input' | 'unauthorized' | 'plan' | 'unavailable' | 'internal';
    readonly retryable: boolean;
    readonly correctable: boolean;
    readonly exitCode: number;
  };
}

type Writer = (text: string) => void;

let enabled = false;
let emitted = false;
let writeStdout: Writer = (text) => { process.stdout.write(text); };
let restoreConsole: (() => void) | undefined;

const CATEGORY: Record<ExitClass, ErrorEnvelope['error']['category']> = {
  correctable: 'correctable_input',
  auth: 'unauthorized',
  plan: 'plan',
  transient: 'unavailable',
  internal: 'internal',
};

/** Route human output to stderr so stdout stays machine-readable. */
export function enableJsonOutput(stdout: Writer = writeStdout): void {
  if (enabled) return;
  enabled = true;
  emitted = false;
  writeStdout = stdout;
  const { log, info } = console;
  console.log = (...args: unknown[]) => console.error(...args);
  console.info = (...args: unknown[]) => console.error(...args);
  restoreConsole = () => {
    console.log = log;
    console.info = info;
  };
}

/** Tests and embedded callers restore normal output. */
export function disableJsonOutput(): void {
  restoreConsole?.();
  restoreConsole = undefined;
  enabled = false;
  emitted = false;
  writeStdout = (text) => { process.stdout.write(text); };
}

export function isJsonOutput(): boolean {
  return enabled;
}

/** Print the command's result. In text mode this is a no-op: the command already logged. */
export function emitResult(result: object): void {
  if (!enabled || emitted) return;
  emitted = true;
  writeStdout(`${JSON.stringify(result, null, 2)}\n`);
}

/** Print the default result for a command that has no structured result yet. */
export function emitDefaultResult(): void {
  emitResult({ ok: true });
}

export function errorEnvelope(error: unknown, exitClass: ExitClass, code: string): ErrorEnvelope {
  const message = error instanceof Error ? error.message : String(error);
  return {
    error: {
      code: isCliError(error) ? error.code : code,
      message,
      ...(isCliError(error) && error.hint ? { hint: error.hint } : {}),
      category: CATEGORY[exitClass],
      retryable: isCliError(error) ? error.retryable : exitClass === 'transient',
      correctable: exitClass === 'correctable',
      exitCode: EXIT_CODES[exitClass],
    },
  };
}

export function emitError(envelope: ErrorEnvelope): void {
  emitResult(envelope);
}
