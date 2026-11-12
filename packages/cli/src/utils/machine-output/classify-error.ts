import { DeploymentUploadError } from '../deployment-upload.js';
import { describeConnectionError } from '../connection-error.js';
import { isPromptCancelled } from '../prompts.js';
import { CliError, type CliErrorCode, type CliErrorCategory } from './cli-error.js';
import type { CloudErrorDetails } from './cloud-error-body.js';

const NETWORK_CODES = new Set([
  'ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT', 'ENOTFOUND', 'EAI_AGAIN', 'EHOSTUNREACH',
  'ENETUNREACH', 'EPIPE', 'UND_ERR_CONNECT_TIMEOUT', 'UND_ERR_SOCKET', 'UND_ERR_HEADERS_TIMEOUT',
]);

const CLOUD_CATEGORY_CODES: Readonly<Partial<Record<CliErrorCategory, CliErrorCode>>> = {
  unauthenticated: 'UNAUTHENTICATED',
  forbidden: 'FORBIDDEN',
  budget_exceeded: 'PLAN_LIMIT',
  stale_contract: 'STALE_STATE',
  unavailable: 'UNAVAILABLE',
  // A Cloud-side failure is transient from the CLI's point of view.
  internal: 'UNAVAILABLE',
  correctable_input: 'CLOUD_REJECTED',
  tenant_unavailable: 'CLOUD_REJECTED',
  cancelled: 'UNAVAILABLE',
};

function codeForStatus(status: number): CliErrorCode {
  if (status === 401) return 'UNAUTHENTICATED';
  if (status === 403) return 'FORBIDDEN';
  if (status === 402) return 'PLAN_LIMIT';
  if (status === 404) return 'NOT_FOUND';
  if (status === 409 || status === 412) return 'STALE_STATE';
  if (status === 408 || status === 429 || status >= 500) return 'UNAVAILABLE';
  return 'CLOUD_REJECTED';
}

/**
 * A failed Cloud response as a CLI error. Cloud's own category, hint and
 * request ID win over what the HTTP status implies, so the CLI relays the
 * envelope Cloud already chose.
 */
export function cloudHttpError(status: number, message: string, cloud: CloudErrorDetails = {}): CliError {
  const code = (cloud.category && CLOUD_CATEGORY_CODES[cloud.category]) ?? codeForStatus(status);
  return new CliError(code, message, {
    ...(cloud.hint ? { hint: cloud.hint } : {}),
    ...(cloud.requestId ? { requestId: cloud.requestId } : {}),
  });
}

function errnoCode(error: unknown): string | undefined {
  if (!error || typeof error !== 'object') return undefined;
  const code = (error as { code?: unknown }).code;
  if (typeof code === 'string') return code;
  const cause = (error as { cause?: unknown }).cause;
  if (cause && typeof cause === 'object') {
    const causeCode = (cause as { code?: unknown }).code;
    if (typeof causeCode === 'string') return causeCode;
  }
  if (error instanceof AggregateError) {
    for (const inner of error.errors) {
      const innerCode = errnoCode(inner);
      if (innerCode) return innerCode;
    }
  }
  return undefined;
}

function uploadError(error: DeploymentUploadError): CliError {
  switch (error.code) {
    case 'HQ_UPLOAD_NETWORK':
    case 'HQ_UPLOAD_INVALID_RESPONSE':
      return new CliError('UNAVAILABLE', error.message, { telemetry: 'cloud_network_error', cause: error });
    case 'HQ_UPLOAD_REJECTED': {
      const mapped = cloudHttpError(error.status ?? 400, error.message, error.cloud);
      return new CliError(mapped.code, error.message, {
        hint: mapped.hint,
        ...(mapped.requestId ? { requestId: mapped.requestId } : {}),
        telemetry: 'cloud_rejected',
        cause: error,
      });
    }
    default:
      return new CliError('INVALID_INPUT', error.message, { telemetry: 'validation_failed', cause: error });
  }
}

/**
 * Classify any failure into a stable CLI error. Commands throw `CliError`
 * where they know the reason; everything else is classified here so every
 * failure has a code, a category and an exit code.
 *
 * An unclassified `Error` stays user-correctable (exit 1), as it always was:
 * most of the CLI's messages describe input to fix. Only failures that cannot
 * be the user's input (a thrown non-Error, a TypeError or ReferenceError from
 * the CLI itself) are `INTERNAL`.
 */
export function toCliError(error: unknown): CliError {
  if (error instanceof CliError) return error;
  if (isPromptCancelled(error)) return new CliError('CANCELLED', 'Cancelled.', { cause: error });
  if (error instanceof DeploymentUploadError) return uploadError(error);

  const code = errnoCode(error);
  const message = describeConnectionError(error);
  if (typeof code === 'string') {
    if (code === 'commander.unknownCommand') return new CliError('USAGE', message, { telemetry: 'unknown_command', cause: error });
    if (code === 'commander.unknownOption') return new CliError('USAGE', message, { telemetry: 'unknown_option', cause: error });
    if (code.startsWith('commander.')) return new CliError('USAGE', message, { cause: error });
    if (NETWORK_CODES.has(code)) return new CliError('UNAVAILABLE', message, { telemetry: 'connection_failed', cause: error });
    if (code === 'ENOENT') return new CliError('NOT_FOUND', message, { telemetry: 'validation_failed', cause: error });
    if (code === 'EEXIST') return new CliError('CONFLICT', message, { cause: error });
    if (code === 'EACCES' || code === 'EPERM' || code === 'EISDIR' || code === 'ENOTDIR') {
      return new CliError('INVALID_INPUT', message, { cause: error });
    }
    if (code === 'AUTHENTICATION_FAILED' || code === '516') {
      return new CliError('CONNECTION_AUTH_FAILED', message, { cause: error });
    }
  }
  if (!(error instanceof Error)) {
    return new CliError('INTERNAL', `Unexpected failure: ${String(error)}`, { cause: error });
  }
  if (error.name === 'TimeoutError' || error.name === 'AbortError' || /\bfetch failed\b/i.test(error.message)) {
    return new CliError('UNAVAILABLE', message, { telemetry: 'connection_failed', cause: error });
  }
  if (/authentication failed|password is incorrect|wrong password/i.test(message)) {
    return new CliError('CONNECTION_AUTH_FAILED', message, { cause: error });
  }
  if (error instanceof TypeError || error instanceof ReferenceError) {
    return new CliError('INTERNAL', message, { cause: error });
  }
  return new CliError('COMMAND_FAILED', message, { cause: error });
}

/**
 * A failure while talking to ClickHouse or chDB: an unreachable server is
 * CONNECTION_FAILED (retryable) and the command has already explained it on
 * stderr, so the human renderer prints nothing more.
 */
export function toDatabaseCliError(error: unknown): CliError {
  const classified = toCliError(error);
  if (classified.code === 'UNAVAILABLE') {
    return new CliError('CONNECTION_FAILED', classified.message, { reported: true, cause: error });
  }
  return new CliError(classified.code, classified.message, {
    reported: true,
    hint: classified.hint,
    telemetry: classified.telemetry,
    ...(classified.issues ? { issues: classified.issues } : {}),
    cause: error,
  });
}
