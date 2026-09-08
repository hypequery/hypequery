import { afterEach, describe, expect, it, vi } from 'vitest';
import { PortableExecutionBudgetError } from '../portable-execution-errors.js';
import { withDeadline } from './portable-execution-deadline.js';

afterEach(() => vi.useRealTimers());

describe('portable execution deadline', () => {
  it('rejects at the deadline even if the adapter never settles', async () => {
    vi.useFakeTimers();
    let signal: AbortSignal | undefined;
    const pending = withDeadline({ maxRows: 10, deadlineMs: 100 }, undefined, async observed => {
      signal = observed;
      return new Promise<never>(() => {});
    });
    const assertion = expect(pending).rejects.toThrow(PortableExecutionBudgetError);
    await vi.advanceTimersByTimeAsync(100);
    await assertion;
    expect(signal?.aborted).toBe(true);
  });

  it('rejects instead of returning a late successful result', async () => {
    vi.useFakeTimers();
    const pending = withDeadline({ maxRows: 10, deadlineMs: 100 }, undefined,
      async () => new Promise(resolve => setTimeout(() => resolve('late rows'), 200)));
    const assertion = expect(pending).rejects.toThrow(PortableExecutionBudgetError);
    await vi.advanceTimersByTimeAsync(200);
    await assertion;
  });

  it('observes a late adapter rejection after the deadline', async () => {
    vi.useFakeTimers();
    const pending = withDeadline({ maxRows: 10, deadlineMs: 100 }, undefined,
      async () => new Promise((_resolve, reject) => setTimeout(() => reject(new Error('late failure')), 200)));
    const assertion = expect(pending).rejects.toThrow(PortableExecutionBudgetError);
    await vi.advanceTimersByTimeAsync(200);
    await assertion;
  });

  it('settles caller cancellation without relying on the adapter', async () => {
    const controller = new AbortController();
    const reason = new Error('caller cancelled');
    const pending = withDeadline({ maxRows: 10 }, controller.signal,
      async () => new Promise<never>(() => {}));
    const assertion = expect(pending).rejects.toBe(reason);
    controller.abort(reason);
    await assertion;
  });

  it('does not start an adapter for an already cancelled invocation', async () => {
    const controller = new AbortController();
    controller.abort();
    const execute = vi.fn(async () => 'rows');
    await expect(withDeadline({ maxRows: 10 }, controller.signal, execute)).rejects.toThrow();
    expect(execute).not.toHaveBeenCalled();
  });

  it('cleans up the timer when execution succeeds', async () => {
    vi.useFakeTimers();
    await expect(withDeadline({ maxRows: 10, deadlineMs: 100 }, undefined, async () => 'rows'))
      .resolves.toBe('rows');
    expect(vi.getTimerCount()).toBe(0);
  });
});
