import { mkdtemp, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../utils/logger.js', () => ({
  logger: {
    error: vi.fn(),
    info: vi.fn(),
    success: vi.fn(),
    indent: vi.fn(),
    newline: vi.fn(),
  },
}));

import { logger } from '../utils/logger.js';
import { mcpCommand } from './mcp.js';

const mcpSourceSymbol = Symbol.for('hypequery.mcp-source.v1');

function apiWithDatasets(datasets: Record<string, unknown>, analytics: unknown = { query: () => [] }) {
  const api = { handler: () => undefined };
  Object.defineProperty(api, mcpSourceSymbol, {
    value: { version: 1, datasets, resolveAnalytics: () => analytics },
    enumerable: false,
  });
  return api;
}

/** A file the entrypoint resolver will accept, so resolution is not mocked. */
async function entrypointFile(): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'hq-mcp-'));
  const file = path.join(dir, 'api.ts');
  await writeFile(file, 'export const api = {};\n', 'utf8');
  return file;
}

describe('hypequery mcp', () => {
  let exit: ReturnType<typeof vi.spyOn>;
  let stderr: ReturnType<typeof vi.spyOn>;

  // --self-test really imports `@hypequery/mcp`, which loads the MCP SDK. Load
  // it once here, with its own budget, so a cold import on a slow CI runner
  // isn't charged to whichever test happens to run first.
  beforeAll(async () => {
    await import('@hypequery/mcp');
  }, 30_000);

  beforeEach(() => {
    vi.clearAllMocks();
    exit = vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
      throw new Error(`process.exit:${code ?? 0}`);
    }) as never);
    stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
  });

  afterEach(() => {
    exit.mockRestore();
    stderr.mockRestore();
  });

  it('serves the datasets the entrypoint already registers', async () => {
    const file = await entrypointFile();
    const analytics = { query: () => [] };
    const start = vi.fn(async () => ({ close: vi.fn(async () => undefined) }));
    const datasets = { orders: { name: 'orders' }, customers: { name: 'customers' } };

    await mcpCommand(file, { selfTest: true }, {
      loadApi: async () => apiWithDatasets(datasets, analytics),
      start,
    });

    // --self-test reports readiness without opening the stdio transport.
    expect(start).not.toHaveBeenCalled();
    expect(logger.info).toHaveBeenCalledWith('Datasets: customers, orders');
  });

  it('hands the registry and shared client to the stdio server', async () => {
    const file = await entrypointFile();
    const analytics = { query: () => [] };
    const datasets = { orders: { name: 'orders' } };
    const start = vi.fn(async () => ({ close: vi.fn(async () => undefined) }));
    const command = mcpCommand(file, {}, {
      loadApi: async () => apiWithDatasets(datasets, analytics),
      start,
    });
    // The command parks on SIGINT once started; release it.
    await vi.waitFor(() => expect(start).toHaveBeenCalled());
    process.emit('SIGINT');
    await command;

    expect(start).toHaveBeenCalledWith({ datasets, analytics });
  });

  it('fails closed when a tenant-scoped dataset has no trusted tenant', async () => {
    const file = await entrypointFile();
    const start = vi.fn(async () => ({ close: vi.fn(async () => undefined) }));

    await expect(mcpCommand(file, {}, {
      loadApi: async () => apiWithDatasets({
        orders: { name: 'orders', tenantKey: 'tenant_id' },
        events: { name: 'events', config: { tenantKey: 'tenant_id' } },
        public: { name: 'public' },
      }),
      start,
    })).rejects.toThrow('process.exit:1');

    expect(start).not.toHaveBeenCalled();
    expect(logger.error).toHaveBeenCalledWith(
      '--tenant is required for tenant-scoped datasets: events, orders',
    );
  });

  it('passes an explicit trusted tenant through to the server', async () => {
    const file = await entrypointFile();
    const analytics = { query: () => [] };
    const datasets = { orders: { name: 'orders', tenantKey: 'tenant_id' } };
    const start = vi.fn(async () => ({ close: vi.fn(async () => undefined) }));

    await mcpCommand(file, { tenant: 'acme', selfTest: true }, {
      loadApi: async () => apiWithDatasets(datasets, analytics),
      start,
    });

    expect(logger.info).toHaveBeenCalledWith('Trusted tenant: acme');
  });

  it('rejects an entrypoint that registers no datasets', async () => {
    const file = await entrypointFile();

    await expect(mcpCommand(file, { selfTest: true }, {
      loadApi: async () => ({ handler: () => undefined }),
    })).rejects.toThrow('process.exit:1');

    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining('does not register any datasets'),
    );
  });

  it.each([false, true])('rejects an attached empty registry before analytics resolution (selfTest=%s)', async selfTest => {
    const resolveAnalytics = vi.fn(() => { throw new Error('Must not resolve analytics'); });
    const api = { [mcpSourceSymbol]: { version: 1, datasets: {}, resolveAnalytics } };
    await expect(mcpCommand(await entrypointFile(), { selfTest }, {
      loadApi: async () => api,
    })).rejects.toThrow('process.exit:1');
    expect(resolveAnalytics).not.toHaveBeenCalled();
  });

  it('keeps application logging off the protocol stream', async () => {
    const file = await entrypointFile();
    const original = console.log;

    await mcpCommand(file, { selfTest: true }, {
      loadApi: async () => {
        // Anything the entrypoint logs while importing would corrupt stdout.
        expect(console.log).not.toBe(original);
        console.log('loaded schema');
        return apiWithDatasets({ orders: { name: 'orders' } });
      },
    });

    expect(stderr).toHaveBeenCalledWith('loaded schema\n');
    expect(console.log).toBe(original);
  });

  it('restores console output even when the entrypoint throws', async () => {
    const file = await entrypointFile();
    const original = console.log;

    await expect(mcpCommand(file, { selfTest: true }, {
      loadApi: async () => { throw new Error('bad entrypoint'); },
    })).rejects.toThrow('bad entrypoint');

    expect(console.log).toBe(original);
  });

  // F7: the self-test used to pass without the optional peer, and the real
  // command then failed on import.
  it('fails the self-test when @hypequery/mcp is not installed', async () => {
    const file = await entrypointFile();

    await expect(mcpCommand(file, { selfTest: true }, {
      loadApi: async () => apiWithDatasets({ orders: { name: 'orders' } }),
      loadMcp: async () => {
        throw Object.assign(new Error("Cannot find package '@hypequery/mcp'"), {
          code: 'ERR_MODULE_NOT_FOUND',
        });
      },
    })).rejects.toThrow('process.exit:1');

    expect(logger.error).toHaveBeenCalledWith(expect.stringContaining('@hypequery/mcp is not installed'));
    expect(logger.indent).toHaveBeenCalledWith('npm install @hypequery/mcp');
    expect(logger.success).not.toHaveBeenCalled();
  });

  describe('--self-test --url', () => {
    const url = 'https://cloud.example.test/api/gateway/p/production/mcp';

    it('checks the hosted endpoint with the key from the environment', async () => {
      const checkRemote = vi.fn(async () => ({ ok: true as const, tools: 3, server: 'hypequery' }));
      const loadApi = vi.fn();

      await mcpCommand(undefined, { selfTest: true, url }, {
        env: { HYPEQUERY_API_KEY: 'hq_key' },
        checkRemote,
        loadApi,
      });

      expect(checkRemote).toHaveBeenCalledWith({ url, key: 'hq_key' });
      expect(loadApi).not.toHaveBeenCalled();
      expect(logger.info).toHaveBeenCalledWith('Tools: 3');
    });

    it('fails loudly when the hosted check fails', async () => {
      await expect(mcpCommand(undefined, { selfTest: true, url }, {
        env: { HYPEQUERY_API_KEY: 'hq_key' },
        checkRemote: async () => ({ ok: false as const, reason: 'the API key was refused (401).' }),
      })).rejects.toThrow('process.exit:1');

      expect(logger.error).toHaveBeenCalledWith(
        'Hosted MCP check failed: the API key was refused (401).',
      );
    });

    it('requires the key in the environment, never on the command line', async () => {
      const checkRemote = vi.fn();

      await expect(mcpCommand(undefined, { selfTest: true, url }, { env: {}, checkRemote }))
        .rejects.toThrow('process.exit:1');

      expect(checkRemote).not.toHaveBeenCalled();
      expect(logger.error).toHaveBeenCalledWith(expect.stringContaining('HYPEQUERY_API_KEY'));
    });

    it('refuses --url without --self-test', async () => {
      await expect(mcpCommand(undefined, { url }, {})).rejects.toThrow('process.exit:1');
    });
  });
});
