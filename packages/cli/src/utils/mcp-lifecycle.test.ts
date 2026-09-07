import { describe, expect, it, vi } from 'vitest';
import { runMcpUntilSignal } from './mcp-lifecycle.js';

describe('MCP signal lifecycle', () => {
  it.each(['SIGINT', 'SIGTERM'] as const)('closes after %s, including signals during startup', async signal => {
    const counts = [process.listenerCount('SIGINT'), process.listenerCount('SIGTERM')];
    const close = vi.fn(async () => undefined);
    await runMcpUntilSignal(async () => {
      process.emit(signal);
      return { close };
    });
    expect(close).toHaveBeenCalledOnce();
    expect([process.listenerCount('SIGINT'), process.listenerCount('SIGTERM')]).toEqual(counts);
  });

  it.each(['start', 'close'])('removes listeners after a %s failure', async phase => {
    const counts = [process.listenerCount('SIGINT'), process.listenerCount('SIGTERM')];
    await expect(runMcpUntilSignal(async () => {
      if (phase === 'start') throw new Error('failure');
      process.emit('SIGTERM');
      return { close: async () => { throw new Error('failure'); } };
    })).rejects.toThrow('failure');
    expect([process.listenerCount('SIGINT'), process.listenerCount('SIGTERM')]).toEqual(counts);
  });
});
