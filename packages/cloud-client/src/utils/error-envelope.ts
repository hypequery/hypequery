import type { CloudErrorBody, CloudInputIssue } from '../errors.js';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readIssues(value: unknown): CloudInputIssue[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const issues = value.filter(
    (issue): issue is CloudInputIssue =>
      isRecord(issue) && typeof issue.path === 'string' && typeof issue.message === 'string',
  );
  return issues.length ? issues.map(({ path, message }) => ({ path, message })) : undefined;
}

/**
 * Reads Cloud's `{ error: { code, message, ... } }` envelope, or `undefined`
 * when `body` isn't one (a proxy's HTML page, an empty body). Only `code` and
 * `message` are required, so an older or partial envelope still parses.
 */
export function parseErrorEnvelope(body: unknown): CloudErrorBody | undefined {
  if (!isRecord(body) || !isRecord(body.error)) return undefined;
  const error = body.error;
  if (typeof error.code !== 'string' || typeof error.message !== 'string') return undefined;
  const category = typeof error.category === 'string' ? error.category : 'internal';
  const issues = readIssues(error.issues);
  return {
    code: error.code,
    message: error.message,
    hint: typeof error.hint === 'string' ? error.hint : '',
    docsUrl: typeof error.docsUrl === 'string' ? error.docsUrl : '',
    category,
    retryable: error.retryable === true,
    correctable:
      typeof error.correctable === 'boolean' ? error.correctable : category === 'correctable_input',
    requestId: typeof error.requestId === 'string' ? error.requestId : '',
    ...(issues ? { issues } : {}),
  };
}
