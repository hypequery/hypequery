import type { CloudApiError } from '@hypequery/cloud-client';
import { CLI_ERROR_CATEGORIES, CliError, type CliErrorCategory } from '../cli-error.js';
import type { ExitClass } from '../exit-codes.js';

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
  const hint = overrides.hint ?? error.hint;
  return new CliError(error.code, error.message, {
    category,
    exitClass,
    retryable: error.retryable,
    telemetryCode: exitClass === 'auth' ? 'auth_failed' : exitClass === 'transient' ? 'cloud_network_error' : 'cloud_rejected',
    ...(hint ? { hint } : {}),
    ...(error.docsUrl ? { docsUrl: error.docsUrl } : {}),
    ...(error.requestId ? { requestId: error.requestId } : {}),
    ...(error.issues?.length ? { issues: error.issues } : {}),
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
