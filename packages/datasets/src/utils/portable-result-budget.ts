import type { ProtocolSemanticInvocationResult } from '@hypequery/protocol';
import type { PortableSemanticBudget } from '../portable-executor.js';
import { PortableExecutionBudgetError } from '../portable-execution-errors.js';

/**
 * Bounds a result by row count and serialized size before it leaves the
 * deployment, so an oversized answer fails rather than being streamed on.
 *
 * The byte budget is measured against the whole record a caller receives, not
 * only its rows, so this agrees with the data plane's own check rather than
 * undercounting by the envelope.
 */
export function bounded(
  result: ProtocolSemanticInvocationResult,
  budget: PortableSemanticBudget,
): ProtocolSemanticInvocationResult {
  if (result.data.length > budget.maxRows) {
    throw new PortableExecutionBudgetError(
      `The result has ${result.data.length} rows; the effective limit is ${budget.maxRows}.`,
    );
  }
  if (budget.maxResponseBytes !== undefined) {
    const bytes = new TextEncoder().encode(JSON.stringify(result)).byteLength;
    if (bytes > budget.maxResponseBytes) {
      throw new PortableExecutionBudgetError(
        `The result is ${bytes} bytes; the effective limit is ${budget.maxResponseBytes}.`,
      );
    }
  }
  return result;
}

