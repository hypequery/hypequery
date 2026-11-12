import type { ERROR_CODES } from '../telemetry/domains.js';

/**
 * Exit codes every `hypequery` command uses (decision 0019, "CLI machine
 * output"). A code never changes meaning once released; agents and scripts
 * branch on it without parsing text. The finer reason is the `code` of the
 * JSON error envelope.
 */
export const CLI_EXIT_CODES = {
  /** The command did what was asked. */
  OK: 0,
  /** Fix the input and run again: bad flags, missing input, file not found, conflict, out of date. */
  USER_CORRECTABLE: 1,
  /** Sign in, or use a credential with access. */
  AUTH: 2,
  /** The organisation's plan does not allow this. */
  PLAN: 3,
  /** A service or database could not be reached; retry later. */
  TRANSIENT: 4,
  /** A bug in hypequery; report it. */
  INTERNAL: 5,
  /** Interrupted (Ctrl+C / SIGINT), including a cancelled prompt. */
  INTERRUPTED: 130,
  /** Terminated (SIGTERM). */
  TERMINATED: 143,
} as const;
export type CliExitCode = typeof CLI_EXIT_CODES[keyof typeof CLI_EXIT_CODES];

/** Decision 0003's nine public categories, shared with Cloud's `/v1` and MCP. */
export const CLI_ERROR_CATEGORIES = [
  'correctable_input',
  'unauthenticated',
  'forbidden',
  'tenant_unavailable',
  'budget_exceeded',
  'cancelled',
  'stale_contract',
  'unavailable',
  'internal',
] as const;
export type CliErrorCategory = typeof CLI_ERROR_CATEGORIES[number];

export const CATEGORY_EXIT_CODES: Readonly<Record<CliErrorCategory, CliExitCode>> = {
  correctable_input: CLI_EXIT_CODES.USER_CORRECTABLE,
  stale_contract: CLI_EXIT_CODES.USER_CORRECTABLE,
  tenant_unavailable: CLI_EXIT_CODES.USER_CORRECTABLE,
  unauthenticated: CLI_EXIT_CODES.AUTH,
  forbidden: CLI_EXIT_CODES.AUTH,
  budget_exceeded: CLI_EXIT_CODES.PLAN,
  unavailable: CLI_EXIT_CODES.TRANSIENT,
  internal: CLI_EXIT_CODES.INTERNAL,
  cancelled: CLI_EXIT_CODES.INTERRUPTED,
};

type TelemetryErrorCode = typeof ERROR_CODES[number];

interface CliErrorSpec {
  readonly category: CliErrorCategory;
  readonly retryable: boolean;
  /** The next action, in one sentence. Specific errors may override it. */
  readonly hint: string;
  readonly telemetry: TelemetryErrorCode;
}

/**
 * Every error code the CLI reports. Codes Cloud's operation registry also
 * declares (UNAUTHENTICATED, FORBIDDEN, CONFIRMATION_REQUIRED, INTERNAL, …)
 * mean the same thing here, so an agent learns one vocabulary.
 */
export const CLI_ERRORS = {
  USAGE: {
    category: 'correctable_input',
    retryable: false,
    hint: 'Run the command with --help to see its arguments and flags.',
    telemetry: 'validation_failed',
  },
  INVALID_INPUT: {
    category: 'correctable_input',
    retryable: false,
    hint: 'Correct the value named in the message and run the command again.',
    telemetry: 'validation_failed',
  },
  INPUT_REQUIRED: {
    category: 'correctable_input',
    retryable: false,
    hint: 'Pass the flag or environment variable named in the message; the CLI does not prompt without a terminal.',
    telemetry: 'validation_failed',
  },
  CONFIRMATION_REQUIRED: {
    category: 'correctable_input',
    retryable: false,
    hint: 'Re-run with the flag named in the message to confirm the change.',
    telemetry: 'validation_failed',
  },
  NOT_FOUND: {
    category: 'correctable_input',
    retryable: false,
    hint: 'Check the path or name in the message, or pass it explicitly.',
    telemetry: 'entrypoint_not_found',
  },
  CONFLICT: {
    category: 'correctable_input',
    retryable: false,
    hint: 'Review the existing file, then re-run with --force to replace it or choose another output.',
    telemetry: 'validation_failed',
  },
  OUT_OF_DATE: {
    category: 'stale_contract',
    retryable: false,
    hint: 'Run the command again without --check (with --force where it applies) to regenerate the output.',
    telemetry: 'output_out_of_date',
  },
  CONNECTION_FAILED: {
    category: 'unavailable',
    retryable: true,
    hint: 'Check that ClickHouse is running and CLICKHOUSE_URL is right, then retry.',
    telemetry: 'connection_failed',
  },
  CONNECTION_AUTH_FAILED: {
    category: 'correctable_input',
    retryable: false,
    hint: 'Check CLICKHOUSE_USERNAME and CLICKHOUSE_PASSWORD and the user\'s grants, then run the command again.',
    telemetry: 'auth_failed',
  },
  NOT_INSTALLED: {
    category: 'correctable_input',
    retryable: false,
    hint: 'Install the package named in the message and run the command again.',
    telemetry: 'not_installed',
  },
  LOAD_FAILED: {
    category: 'correctable_input',
    retryable: false,
    hint: 'Fix the error in your module (shown in the message) and run the command again.',
    telemetry: 'load_error',
  },
  UNAUTHENTICATED: {
    category: 'unauthenticated',
    retryable: false,
    hint: 'Run `hypequery login`, or set HYPEQUERY_API_TOKEN with --endpoint or HYPEQUERY_DEPLOYMENT_ENDPOINT.',
    telemetry: 'auth_failed',
  },
  FORBIDDEN: {
    category: 'forbidden',
    retryable: false,
    hint: 'Ask an organisation Admin to do this, or to change your role or the credential\'s project access.',
    telemetry: 'auth_failed',
  },
  PLAN_LIMIT: {
    category: 'budget_exceeded',
    retryable: false,
    hint: 'Upgrade the organisation\'s plan in hypequery Cloud, or reduce what this command asks for.',
    telemetry: 'cloud_rejected',
  },
  CLOUD_REJECTED: {
    category: 'correctable_input',
    retryable: false,
    hint: 'Read Cloud\'s reason in the message, correct the request, and run the command again.',
    telemetry: 'cloud_rejected',
  },
  STALE_STATE: {
    category: 'stale_contract',
    retryable: false,
    hint: 'The live deployment changed since this command read it; re-run the command to act on the current state.',
    telemetry: 'cloud_rejected',
  },
  UNAVAILABLE: {
    category: 'unavailable',
    retryable: true,
    hint: 'A service could not be reached or failed temporarily; retry in a moment.',
    telemetry: 'cloud_network_error',
  },
  CANCELLED: {
    category: 'cancelled',
    retryable: false,
    hint: 'The command was cancelled before it finished; run it again to continue.',
    telemetry: 'prompt_cancelled',
  },
  COMMAND_FAILED: {
    category: 'correctable_input',
    retryable: false,
    hint: 'Read the message, correct the cause, and run the command again.',
    telemetry: 'unknown',
  },
  INTERNAL: {
    category: 'internal',
    retryable: false,
    hint: 'This is a hypequery bug. Re-run with the same input; if it persists, report it at https://github.com/hypequery/hypequery/issues.',
    telemetry: 'unknown',
  },
} as const satisfies Record<string, CliErrorSpec>;
export type CliErrorCode = keyof typeof CLI_ERRORS;

/** The CLI reference section that documents every exit and error code. */
export const CLI_ERROR_DOCS_URL = 'https://hypequery.com/docs/reference/api/cli#exit-codes-and-errors';

/** A field or argument that failed validation, by path (Cloud's `InputIssue`). */
export interface CliInputIssue {
  readonly path: string;
  readonly message: string;
}

export interface CliErrorOptions {
  /** Overrides the catalog hint when the next step is more specific. */
  readonly hint?: string;
  readonly issues?: readonly CliInputIssue[];
  /** Cloud's request ID, when the error came from a Cloud response. */
  readonly requestId?: string;
  /** Overrides the catalog telemetry code. */
  readonly telemetry?: TelemetryErrorCode;
  /**
   * The command already explained the failure on stderr, so the human renderer
   * prints nothing more. JSON output always gets the envelope.
   */
  readonly reported?: boolean;
  readonly cause?: unknown;
}

/**
 * A failure with a stable code, thrown by commands and turned into an exit code
 * and (with `--json`) an error envelope at the edge, in `runCommand`.
 */
export class CliError extends Error {
  readonly hint: string;
  readonly issues?: readonly CliInputIssue[];
  readonly requestId?: string;
  readonly telemetry: TelemetryErrorCode;
  readonly reported: boolean;

  constructor(readonly code: CliErrorCode, message: string, options: CliErrorOptions = {}) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = 'CliError';
    this.hint = options.hint ?? CLI_ERRORS[code].hint;
    if (options.issues?.length) this.issues = options.issues;
    if (options.requestId) this.requestId = options.requestId;
    this.telemetry = options.telemetry ?? CLI_ERRORS[code].telemetry;
    this.reported = options.reported === true;
  }

  get category(): CliErrorCategory {
    return CLI_ERRORS[this.code].category;
  }

  get exitCode(): CliExitCode {
    return CATEGORY_EXIT_CODES[this.category];
  }
}

export function isCliError(error: unknown): error is CliError {
  return error instanceof CliError;
}

/** The `--json` error document; the same shape as Cloud's `/v1` and MCP errors. */
export interface CliErrorEnvelope {
  readonly error: {
    readonly code: CliErrorCode;
    readonly message: string;
    readonly hint: string;
    readonly docsUrl: string;
    readonly category: CliErrorCategory;
    readonly retryable: boolean;
    readonly correctable: boolean;
    readonly exitCode: CliExitCode;
    readonly requestId?: string;
    readonly issues?: readonly CliInputIssue[];
  };
}

export function cliErrorEnvelope(error: CliError): CliErrorEnvelope {
  const spec = CLI_ERRORS[error.code];
  return {
    error: {
      code: error.code,
      message: error.message,
      hint: error.hint,
      docsUrl: CLI_ERROR_DOCS_URL,
      category: spec.category,
      retryable: spec.retryable,
      correctable: spec.category === 'correctable_input',
      exitCode: error.exitCode,
      ...(error.requestId ? { requestId: error.requestId } : {}),
      ...(error.issues?.length ? { issues: error.issues } : {}),
    },
  };
}
