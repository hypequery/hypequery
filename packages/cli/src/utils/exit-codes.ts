import type { ERROR_CODES } from './telemetry/domains.js';

/**
 * Fixed exit codes, so scripts and coding agents can branch on the kind of
 * failure without parsing text. Documented in `hypequery --help`.
 */
export const EXIT_CODES = {
  ok: 0,
  /** Something the caller can fix: an argument, a file, a missing option. */
  correctable: 1,
  /** Not signed in, an expired or refused credential. */
  auth: 2,
  /** The plan doesn't allow it; a human has to act. */
  plan: 3,
  /** A network or service failure worth retrying. */
  transient: 4,
  /** A bug in hypequery. */
  internal: 5,
  /** Ctrl+C at a prompt or SIGINT. */
  interrupted: 130,
} as const;

export type ExitClass = Exclude<keyof typeof EXIT_CODES, 'ok' | 'interrupted'>;

const CLASS_BY_CODE: Partial<Record<typeof ERROR_CODES[number], ExitClass>> = {
  auth_failed: 'auth',
  connection_failed: 'transient',
  cloud_network_error: 'transient',
};

/** The exit class for a failure the CLI could only classify by its telemetry code. */
export function exitClassFor(code: typeof ERROR_CODES[number], error?: unknown): ExitClass {
  const known = CLASS_BY_CODE[code];
  if (known) return known;
  // Programming errors are ours; anything else unclassified is reported to the
  // caller as something to correct, as every failure was before fixed codes.
  if (code === 'unknown' && isProgrammingError(error)) return 'internal';
  return 'correctable';
}

function isProgrammingError(error: unknown) {
  return error instanceof TypeError || error instanceof ReferenceError || error instanceof RangeError;
}
