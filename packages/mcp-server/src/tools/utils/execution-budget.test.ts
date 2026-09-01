import { describe, expect, it } from 'vitest';
import {
  executeWithinBudget,
  resolveExecutionBudget,
  serializeWithinBudget,
} from './execution-budget.js';

function waitForAbort(signal: AbortSignal): Promise<never> {
  return new Promise((_, reject) => {
    signal.addEventListener('abort', () => reject(signal.reason), { once: true });
  });
}

describe('execution budgets', () => {
  it('resolves bounded defaults and rejects unsafe configuration', () => {
    expect(resolveExecutionBudget()).toEqual({
      timeoutMs: 30_000,
      maxResponseBytes: 1_048_576,
    });
    expect(() => resolveExecutionBudget({ timeoutMs: 0 }))
      .toThrow('timeoutMs must be an integer between 1 and 120000');
    expect(() => resolveExecutionBudget({ maxResponseBytes: 10_485_761 }))
      .toThrow('maxResponseBytes must be an integer between 1 and 10485760');
  });

  it('propagates request cancellation with a stable classification', async () => {
    const request = new AbortController();
    const pending = executeWithinBudget(
      waitForAbort,
      resolveExecutionBudget({ timeoutMs: 1_000 }),
      request.signal,
    );

    request.abort();

    await expect(pending).rejects.toMatchObject({
      code: 'MCP_REQUEST_CANCELLED',
    });
  });

  it('aborts slow queries at the configured deadline', async () => {
    await expect(executeWithinBudget(
      waitForAbort,
      resolveExecutionBudget({ timeoutMs: 1 }),
    )).rejects.toMatchObject({
      code: 'MCP_QUERY_TIMEOUT',
    });
  });

  it('returns at the deadline when a custom executor ignores cancellation', async () => {
    await expect(executeWithinBudget(
      () => new Promise(() => {}),
      resolveExecutionBudget({ timeoutMs: 1 }),
    )).rejects.toMatchObject({
      code: 'MCP_QUERY_TIMEOUT',
    });
  });

  it('enforces the UTF-8 serialized response byte ceiling', () => {
    const budget = resolveExecutionBudget({ maxResponseBytes: 3 });

    expect(() => serializeWithinBudget('é', budget)).toThrowError(
      expect.objectContaining({
        code: 'MCP_RESULT_TOO_LARGE',
      }),
    );
  });
});
