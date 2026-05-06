import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(() => {
  vi.resetModules();
  vi.doUnmock('module');
});

describe('getAutoClientModule', () => {
  it('resolves the Node client from the package module location', async () => {
    const createClient = vi.fn();
    const requireSpy = vi.fn((specifier: string) => {
      expect(specifier).toBe('@clickhouse/client');
      return { createClient, ClickHouseSettings: { output_format_json_quote_64bit_integers: 0 } };
    });
    const createRequireSpy = vi.fn(() => requireSpy);

    vi.doMock('module', () => ({
      createRequire: createRequireSpy,
    }));

    const { getAutoClientModule } = await import('../env/auto-client.js');
    const clientModule = getAutoClientModule();

    expect(createRequireSpy).toHaveBeenCalledWith(new URL('../env/auto-client.ts', import.meta.url).href);
    expect(requireSpy).toHaveBeenCalledWith('@clickhouse/client');
    expect(clientModule.createClient).toBe(createClient);
    expect(clientModule.ClickHouseSettings).toEqual({ output_format_json_quote_64bit_integers: 0 });
  });

  it('keeps the existing error message when the Node client cannot be resolved', async () => {
    const resolutionError = new Error('module not found');

    vi.doMock('module', () => ({
      createRequire: vi.fn(() => {
        return () => {
          throw resolutionError;
        };
      }),
    }));

    const { getAutoClientModule } = await import('../env/auto-client.js');

    expect(() => getAutoClientModule()).toThrowError(
      '@clickhouse/client is required for Node.js environments.\n\n' +
      'Install with: npm install @clickhouse/client\n\n' +
      'Alternatively, you can provide a client instance directly in the config.client option.'
    );

    try {
      getAutoClientModule();
    } catch (error) {
      expect(error).toBeInstanceOf(Error);
      expect((error as Error).cause).toBe(resolutionError);
    }
  });
});
