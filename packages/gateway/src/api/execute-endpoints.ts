import type { EndpointContext } from './types.js';
import { parseBody, sendJSON, sendError } from './helpers.js';
import { randomUUID } from 'node:crypto';
import type {
  ExecuteFailure,
  ExecuteRequest,
  ExecuteSuccess,
} from '@hypequery/gateway-contract';

/**
 * POST /__dev/execute
 * Run a serve endpoint through the REAL pipeline (auth/tenant/rate-limit) via
 * DevIntegrationApi.execute(). Written fresh — the donor's execute endpoint
 * called api.execute() directly and was deleted upstream.
 *
 * Query history (incl. generated SQL) is persisted separately by the
 * DevQueryLogger listening on serve's queryLogger, and streamed over
 * /__dev/events. This endpoint returns the direct result plus timing.
 */
export async function execute(ctx: EndpointContext): Promise<void> {
  const startTime = Date.now();
  let queryId: string | undefined;
  try {
    if (!ctx.api?.execute) {
      return sendError(ctx.res, 'Execution not available', 503);
    }

    const body = (await parseBody(ctx.req)) as Partial<ExecuteRequest>;
    const key = body?.key;
    if (!key || typeof key !== 'string') {
      return sendError(ctx.res, 'key is required', 400);
    }

    // The dev auth-context picker is not implemented yet; the contract
    // forbids silently ignoring `context` (a developer simulating a tenant
    // must never get un-scoped results labelled as scoped ones).
    if (body?.context !== undefined) {
      const response: ExecuteFailure = {
        success: false,
        error: {
          type: 'context_not_allowed',
          message: 'This gateway does not support an execution context override yet.'
        },
        timestamp: Date.now()
      };
      return sendJSON(ctx.res, response, 400);
    }

    queryId = randomUUID();
    const result = await ctx.api.execute(key, { input: body.input, requestId: queryId });
    const durationMs = Date.now() - startTime;

    const response: ExecuteSuccess = {
      success: true,
      queryId,
      key,
      result,
      durationMs,
      timestamp: Date.now()
    };
    sendJSON(ctx.res, response);
  } catch (error) {
    const durationMs = Date.now() - startTime;
    const message = error instanceof Error ? error.message : String(error);
    const type =
      error && typeof error === 'object' && 'type' in error && typeof error.type === 'string'
        ? error.type
        : undefined;
    const details =
      error && typeof error === 'object' && 'details' in error
        ? (error as { details?: unknown }).details
        : undefined;
    const errorStatus =
      error && typeof error === 'object' && 'status' in error && typeof error.status === 'number'
        ? error.status
        : undefined;
    const status =
      errorStatus ??
      ({
        VALIDATION_ERROR: 400,
        UNAUTHORIZED: 401,
        FORBIDDEN: 403,
        RATE_LIMITED: 429,
        SERVICE_UNAVAILABLE: 503
      }[type ?? ''] ?? 500);

    const response: ExecuteFailure = {
      success: false,
      ...(queryId ? { queryId } : {}),
      error: { type, message, ...(details ? { details } : {}) },
      durationMs,
      timestamp: Date.now()
    };
    sendJSON(ctx.res, response, status);
  }
}
