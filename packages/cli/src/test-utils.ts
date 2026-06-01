import { vi } from 'vitest';
import type { Mock } from 'vitest';

/**
 * Mock process.exit to prevent tests from exiting
 * Throws a special error to stop execution
 */
export class ProcessExitError extends Error {
  constructor(public code: number) {
    super(`process.exit called with code ${code}`);
    this.name = 'ProcessExitError';
  }
}

export function mockProcessExit() {
  const originalExit = process.exit;
  const exitMock = vi.fn((code?: number) => {
    throw new ProcessExitError(code ?? 0);
  }) as Mock;

  process.exit = exitMock as unknown as typeof process.exit;

  return {
    exitMock,
    restore: () => {
      process.exit = originalExit;
    },
  };
}
