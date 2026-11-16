import type { CloudApiError } from '@hypequery/cloud-client';
import { CLI_ERROR_CATEGORIES, CliError, type CliErrorCategory } from '../cli-error.js';
import type { ExitClass } from '../exit-codes.js';
import { terminalSafeText } from '../terminal-text.js';

/** As `cloudHttpError`: Cloud's own failures (internal, cancelled) are worth retrying, not a CLI bug. */
const EXIT_CLASS: Readonly<Record<CliErrorCategory, ExitClass>> = {
  correctable_input: 'correctable',
  stale_contract: 'correctable',
  tenant_unavailable: 'correctable',
  unauthenticated: 'auth',
  forbidden: 'auth',
  budget_exceeded: 'plan',
  unavailable: 'transient',
  cancelled: 'transient',
  internal: 'transient',
};

function knownCategory(category: string): CliErrorCategory | undefined {
  return (CLI_ERROR_CATEGORIES as readonly string[]).includes(category) ? category as CliErrorCategory : undefined;
}

/**
 * A failed operation, reported with Cloud's own envelope: its code (e.g.
 * RELEASE_MOVED), message, hint, docs URL, category, request ID and issues.
 * The exit code follows the category.
 */
export function cliErrorFromCloud(error: CloudApiError, overrides: { readonly hint?: string } = {}): CliError {
  const category = knownCategory(error.category)
    ?? (error.status !== undefined && error.status < 500 ? 'correctable_input' : 'unavailable');
  const exitClass = EXIT_CLASS[category];
  // Every string here came from the server and reaches the terminal: no
  // control characters (ANSI escapes), bounded length.
  const hint = overrides.hint ?? terminalSafeText(error.hint);
  const code = /^[A-Z][A-Z0-9_]{0,63}$/.test(error.code) ? error.code : 'CLOUD_REQUEST_FAILED';
  const message = terminalSafeText(error.message, 2048) ?? `hypequery Cloud rejected ${error.operation}.`;
  const docsUrl = terminalSafeText(error.docsUrl, 2048);
  const requestId = terminalSafeText(error.requestId, 128);
  const issues = error.issues?.slice(0, 100).map(issue => ({
    path: terminalSafeText(issue.path, 256) ?? '(root)',
    message: terminalSafeText(issue.message) ?? 'invalid',
  }));
  return new CliError(code, message, {
    category,
    exitClass,
    retryable: error.retryable,
    telemetryCode: exitClass === 'auth' ? 'auth_failed' : exitClass === 'transient' ? 'cloud_network_error' : 'cloud_rejected',
    ...(hint ? { hint } : {}),
    ...(docsUrl ? { docsUrl } : {}),
    ...(requestId ? { requestId } : {}),
    ...(issues?.length ? { issues } : {}),
  });
}

/**
 * The lines text mode prints under the message of a failure that carries
 * Cloud's envelope: the next action, the docs page, the request ID to quote,
 * and each field to fix.
 */
export function cloudErrorDetailLines(error: CliError): string[] {
  return [
    ...(error.issues ?? []).map(issue => `  ${issue.path}: ${issue.message}`),
    ...(error.hint ? [`Hint: ${error.hint}`] : []),
    ...(error.docsUrl ? [`Docs: ${error.docsUrl}`] : []),
    ...(error.requestId ? [`Request ID: ${error.requestId}`] : []),
    `Code: ${error.code}`,
  ];
}
