import type { PortableSemanticBudget } from '../portable-executor.js';
import { PortableExecutionBudgetError } from '../portable-execution-errors.js';

/** Abort the underlying request and independently settle the invocation on expiry. */
export async function withDeadline<T>(
  budget: PortableSemanticBudget,
  signal: AbortSignal | undefined,
  execute: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  if (signal?.aborted) throw signal.reason ?? new Error('The invocation was cancelled.');
  const controller = new AbortController();
  const abort = () => controller.abort(signal?.reason);
  let rejectAbort: () => void = () => {};
  const cancelled = new Promise<never>((_resolve, reject) => {
    rejectAbort = () => reject(controller.signal.reason);
    controller.signal.addEventListener('abort', rejectAbort, { once: true });
  });
  signal?.addEventListener('abort', abort, { once: true });
  const timer = budget.deadlineMs === undefined ? undefined : setTimeout(() => {
    controller.abort(new PortableExecutionBudgetError(
      `The invocation exceeded its ${String(budget.deadlineMs)}ms deadline.`,
    ));
  }, budget.deadlineMs);
  try {
    // Promise.race also observes a late driver rejection after cancellation.
    return await Promise.race([cancelled, execute(controller.signal)]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
    signal?.removeEventListener('abort', abort);
    controller.signal.removeEventListener('abort', rejectAbort);
  }
}
