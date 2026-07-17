import { describe, expect, it } from 'vitest';
import { createGateway } from './gateway.js';
import type { DevIntegrationApi } from './types.js';

/** Minimal DevIntegrationApi stub for capability tests. */
function makeApi(clearSupported: boolean): DevIntegrationApi {
  return {
    queryLogger: { on: () => () => {} } as unknown as DevIntegrationApi['queryLogger'],
    describe: () => ({ basePath: '/api', queries: [] }),
    execute: async () => ({}),
    cacheObservability: {
      getStats: async () =>
        clearSupported
          ? [{ layer: 'semantic' as const, stats: {}, clearSupported: true }]
          : [],
      clear: async () => ({ cleared: [] }),
    },
  } as DevIntegrationApi;
}

describe('createGateway capabilities', () => {
  it('always advertises telemetry — the endpoints are always mounted', async () => {
    const gateway = await createGateway(makeApi(false), {
      storage: { forceMemory: true, silent: true },
    });

    expect(gateway.capabilities).toContain('telemetry');
    expect(gateway.capabilities).toEqual(
      expect.arrayContaining(['registry', 'execute', 'history', 'events', 'cache'])
    );
    expect(gateway.capabilities).not.toContain('cache:clear');
    await gateway.shutdown();
  });

  it('advertises cache:clear only when a layer supports clearing', async () => {
    const gateway = await createGateway(makeApi(true), {
      storage: { forceMemory: true, silent: true },
    });

    expect(gateway.capabilities).toContain('cache:clear');
    await gateway.shutdown();
  });
});
