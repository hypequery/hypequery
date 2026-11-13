import chalk from 'chalk';
import type { StdioOptions } from 'node:child_process';
import { DEFAULT_CATEGORY, isCliError, type CliErrorCategory, type CliInputIssue } from './cli-error.js';
import { EXIT_CODES, type ExitClass } from './exit-codes.js';
import { isUnattended } from './input-mode.js';

/** The CLI reference section that documents every exit code and error code. */
export const CLI_ERRORS_DOCS_URL = 'https://hypequery.com/docs/reference/api/cli#exit-codes-and-errors';

/**
 * `--json`: stdout carries exactly one JSON document, the command's result or
 * the error envelope, and everything a person would read goes to stderr.
 * Scripts and coding agents parse stdout and branch on the exit code.
 */
export interface ErrorEnvelope {
  readonly error: {
    readonly code: string;
    readonly message: string;
    readonly hint: string;
    readonly docsUrl: string;
    /** Decision 0003's categories, as in Cloud's `/v1` and MCP errors. */
    readonly category: CliErrorCategory;
    readonly retryable: boolean;
    readonly correctable: boolean;
    readonly exitCode: number;
    readonly requestId?: string;
    readonly issues?: readonly CliInputIssue[];
  };
}

type Writer = (text: string) => void | Promise<void>;

let enabled = false;
let emitted = false;
const processStdout: Writer = (text) => new Promise<void>((resolve) => {
  process.stdout.write(text, () => resolve());
});
let writeStdout: Writer = processStdout;
let pendingWrite: Promise<void> = Promise.resolve();
let restoreConsole: (() => void) | undefined;
let suppressed = 0;

/** The next action when a failure carries no more specific hint. */
const DEFAULT_HINT: Record<ExitClass, string> = {
  correctable: 'Correct what the message names and run the command again.',
  auth: 'Run `hypequery login`, or set HYPEQUERY_API_TOKEN with --endpoint.',
  plan: 'Upgrade the organisation\'s plan in hypequery Cloud, or ask for less.',
  transient: 'Retry in a moment.',
  internal: 'This is a hypequery bug; report it at https://github.com/hypequery/hypequery/issues.',
};

/** Route human output to stderr so stdout stays machine-readable. */
export function enableJsonOutput(stdout: Writer = writeStdout): void {
  if (enabled) return;
  enabled = true;
  emitted = false;
  writeStdout = stdout;
  // Node writes log, info and debug to stdout; send all of them to stderr.
  const { log, info, debug } = console;
  console.log = (...args: unknown[]) => console.error(...args);
  console.info = (...args: unknown[]) => console.error(...args);
  console.debug = (...args: unknown[]) => console.error(...args);
  // Logs on stderr are for agents as much as people: no colour escapes, for
  // the whole process (dev keeps logging after its ready document).
  const colourLevel = chalk.level;
  chalk.level = 0;
  restoreConsole = () => {
    console.log = log;
    console.info = info;
    console.debug = debug;
    chalk.level = colourLevel;
  };
}

/** Tests and embedded callers restore normal output. */
export function disableJsonOutput(): void {
  restoreConsole?.();
  restoreConsole = undefined;
  enabled = false;
  emitted = false;
  writeStdout = processStdout;
  pendingWrite = Promise.resolve();
}

export function isJsonOutput(): boolean {
  return enabled;
}

/** Print the command's result. In text mode this is a no-op: the command already logged. */
export function emitResult(result: object): void {
  if (!enabled || emitted || suppressed > 0) return;
  emitted = true;
  write(`${JSON.stringify(result, null, 2)}\n`);
}

function write(text: string): void {
  pendingWrite = Promise.resolve(writeStdout(text)).catch(() => undefined);
}

/**
 * Resolves once the JSON document has been handed to the OS, or after
 * `timeoutMs` if the reader stopped reading. The executable awaits it before
 * `process.exit()`, which would otherwise drop a large document still queued
 * on a pipe; the bound keeps a stalled pipe from holding the process open.
 */
export function flushJsonOutput(timeoutMs = 5_000): Promise<void> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<void>((resolve) => {
    timer = setTimeout(resolve, timeoutMs);
    timer.unref();
  });
  return Promise.race([pendingWrite, timeout]).finally(() => clearTimeout(timer));
}

/**
 * Print a result that is already serialized JSON, byte for byte. For commands
 * whose output format is fixed, such as `export:client-contract --stdout`.
 */
export function emitJsonText(text: string): void {
  if (!enabled || emitted || suppressed > 0) return;
  emitted = true;
  write(text.endsWith('\n') ? text : `${text}\n`);
}

/**
 * Run a command that is one step of another (`deploy` builds a bundle and
 * prepares a release before submitting it), so only the outer command's
 * result reaches stdout.
 */
export async function withoutResult<T>(step: () => Promise<T>): Promise<T> {
  suppressed += 1;
  try {
    return await step();
  } finally {
    suppressed -= 1;
  }
}

/**
 * Stdio for child processes such as package managers. Their output bypasses the
 * console, so in `--json` mode it goes to stderr. With `--json`, `--no-input`
 * or CI they get no stdin, so an install script cannot wait for an answer.
 */
export function childProcessStdio(): StdioOptions {
  if (enabled) return ['ignore', 2, 2];
  // Unattended (--no-input or CI): output as usual, but no stdin to wait on.
  return isUnattended() ? ['ignore', 'inherit', 'inherit'] : 'inherit';
}

/** Print the default result for a command that has no structured result yet. */
export function emitDefaultResult(): void {
  emitResult({ ok: true });
}

export function errorEnvelope(
  error: unknown,
  exitClass: ExitClass,
  code: string,
  exitCode: number = EXIT_CODES[exitClass],
): ErrorEnvelope {
  const message = error instanceof Error ? error.message : String(error);
  const category = isCliError(error) ? error.category : DEFAULT_CATEGORY[exitClass];
  return {
    error: {
      code: isCliError(error) ? error.code : code,
      message,
      hint: isCliError(error) && error.hint ? error.hint : DEFAULT_HINT[exitClass],
      docsUrl: CLI_ERRORS_DOCS_URL,
      category,
      retryable: isCliError(error) ? error.retryable : exitClass === 'transient',
      // As in Cloud: only correctable_input is something to fix and resubmit.
      correctable: category === 'correctable_input',
      exitCode,
      ...(isCliError(error) && error.requestId ? { requestId: error.requestId } : {}),
      ...(isCliError(error) && error.issues?.length ? { issues: error.issues } : {}),
    },
  };
}

export function emitError(envelope: ErrorEnvelope): void {
  emitResult(envelope);
}
