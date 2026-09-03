import { MCPExecutionBudgetError } from '../../errors.js';
import {
  DEFAULT_QUERY_TIMEOUT_MS,
  DEFAULT_RESPONSE_BYTES,
  MAX_QUERY_TIMEOUT_MS,
  MAX_RESPONSE_BYTES,
  type MCPExecutionBudget,
} from '../../types.js';
import { createMCPResultTooLargeResponse } from './tool-response.js';

export const MIN_RESPONSE_BYTES = Buffer.byteLength(
  JSON.stringify(createMCPResultTooLargeResponse()),
  'utf8',
);

export interface EffectiveExecutionBudget {
  readonly timeoutMs: number;
  readonly maxResponseBytes: number;
}

function positiveInteger(
  value: number | undefined,
  fallback: number,
  maximum: number,
  name: string,
): number {
  const resolved = value ?? fallback;
  const minimum = name === 'maxResponseBytes' ? MIN_RESPONSE_BYTES : 1;
  if (!Number.isSafeInteger(resolved) || resolved < minimum || resolved > maximum) {
    throw new Error(`${name} must be an integer between ${minimum} and ${maximum}`);
  }
  return resolved;
}

export function resolveExecutionBudget(
  configured: MCPExecutionBudget = {},
): EffectiveExecutionBudget {
  return Object.freeze({
    timeoutMs: positiveInteger(
      configured.timeoutMs,
      DEFAULT_QUERY_TIMEOUT_MS,
      MAX_QUERY_TIMEOUT_MS,
      'timeoutMs',
    ),
    maxResponseBytes: positiveInteger(
      configured.maxResponseBytes,
      DEFAULT_RESPONSE_BYTES,
      MAX_RESPONSE_BYTES,
      'maxResponseBytes',
    ),
  });
}

export async function executeWithinBudget<T>(
  operation: (signal: AbortSignal) => Promise<T>,
  budget: EffectiveExecutionBudget,
  requestSignal?: AbortSignal,
): Promise<T> {
  const controller = new AbortController();
  const cancellationError = new MCPExecutionBudgetError(
    'MCP_REQUEST_CANCELLED',
    'The MCP request was cancelled',
  );
  const timeoutError = new MCPExecutionBudgetError(
    'MCP_QUERY_TIMEOUT',
    `The query exceeded its ${budget.timeoutMs}ms execution deadline`,
  );
  const cancel = () => controller.abort(cancellationError);

  if (requestSignal?.aborted) {
    throw cancellationError;
  }
  requestSignal?.addEventListener('abort', cancel, { once: true });
  const timeout = setTimeout(() => controller.abort(timeoutError), budget.timeoutMs);
  let removeBudgetAbortListener = () => {};
  const budgetAbort = new Promise<never>((_, reject) => {
    const rejectForAbort = () => reject(controller.signal.reason);
    if (controller.signal.aborted) {
      rejectForAbort();
      return;
    }
    controller.signal.addEventListener('abort', rejectForAbort, { once: true });
    removeBudgetAbortListener = () => {
      controller.signal.removeEventListener('abort', rejectForAbort);
    };
  });

  try {
    const result = await Promise.race([operation(controller.signal), budgetAbort]);
    if (controller.signal.aborted) throw controller.signal.reason;
    return result;
  } catch (error) {
    if (controller.signal.aborted) throw controller.signal.reason;
    throw error;
  } finally {
    clearTimeout(timeout);
    removeBudgetAbortListener();
    requestSignal?.removeEventListener('abort', cancel);
  }
}

export function serializeWithinBudget(
  value: unknown,
  budget: EffectiveExecutionBudget,
): string {
  const serialized = JSON.stringify(value);
  assertSerializedWithinBudget(serialized, budget);
  return serialized;
}

export function assertWithinBudget(
  value: unknown,
  budget: EffectiveExecutionBudget,
): void {
  assertSerializedWithinBudget(JSON.stringify(value), budget);
}

function assertSerializedWithinBudget(
  serialized: string,
  budget: EffectiveExecutionBudget,
): void {
  const size = Buffer.byteLength(serialized, 'utf8');
  if (size > budget.maxResponseBytes) {
    throw new MCPExecutionBudgetError(
      'MCP_RESULT_TOO_LARGE',
      `The serialized result is ${size} bytes; maximum is ${budget.maxResponseBytes} bytes`,
    );
  }
}
