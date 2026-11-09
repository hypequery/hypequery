import { mkdtemp, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../utils/logger.js', () => ({
  logger: { error: vi.fn(), info: vi.fn(), success: vi.fn(), indent: vi.fn(), newline: vi.fn() },
}));

import * as mcpPackage from '@hypequery/mcp';
import { logger } from '../utils/logger.js';
import { mcpHttpSettings, McpHttpUsageError, type RunMcpHttpServerInput } from '../utils/mcp-http-server.js';
import { mcpCommand } from './mcp.js';

const mcpSourceSymbol = Symbol.for('hypequery.mcp-source.v1');
const KEY = 'cli-static-key-0123456789';

function apiWithDatasets(datasets: Record<string, unknown>, auth?: unknown, restricted?: unknown) {
  const api = {};
  Object.defineProperty(api, mcpSourceSymbol, {
    value: {
      version: 1,
      datasets,
      resolveAnalytics: () => ({ query: () => [] }),
      ...(auth ? { auth } : {}),
      ...(restricted ? { restricted } : {}),
    },
    enumerable: false,
  });
  return api;
}

async function entrypointFile(): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'hq-mcp-http-'));
  const file = path.join(dir, 'api.ts');
  await writeFile(file, 'export const api = {};\n', 'utf8');
  return file;
}

function request(token?: string): Request {
  return new Request('http://localhost/mcp', { headers: token ? { authorization: `Bearer ${token}` } : {} });
}

describe('hypequery mcp --http', () => {
  let exit: ReturnType<typeof vi.spyOn>;
  let stderr: ReturnType<typeof vi.spyOn>;

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

  async function serve(options: Parameters<typeof mcpCommand>[1], api: unknown, env: Record<string, string> = {}) {
    const serveHttp = vi.fn(async (_input: RunMcpHttpServerInput) => undefined);
    await mcpCommand(await entrypointFile(), { http: true, ...options }, {
      loadApi: async () => api,
      loadMcp: async () => mcpPackage,
      serveHttp,
      env,
    });
    expect(serveHttp).toHaveBeenCalledTimes(1);
    return serveHttp.mock.calls[0][0];
  }

  it('serves local datasets behind HYPEQUERY_MCP_KEY with the --tenant', async () => {
    const input = await serve({ tenant: 'acme' }, apiWithDatasets({ orders: { name: 'orders', tenantKey: 'org_id' } }), {
      HYPEQUERY_MCP_KEY: KEY,
    });
    expect(input.settings).toMatchObject({ port: 3333, host: '127.0.0.1', allowedHosts: ['localhost', '127.0.0.1', '[::1]'] });
    await expect(input.authenticate(request(KEY))).resolves.toEqual({ subject: 'static-key', tenantId: 'acme' });
    await expect(input.authenticate(request('wrong'))).rejects.toMatchObject({ code: 'invalid_token' });
  });

  it("reuses defineServe auth, taking each caller's tenant from its credential", async () => {
    const strategy = vi.fn(async ({ request: req }: { request: { headers: Record<string, string> } }) => (
      req.headers.authorization === 'Bearer good' ? { userId: 'u1', org: 'acme' } : null
    ));
    const api = apiWithDatasets({ orders: { name: 'orders', tenantKey: 'org_id' } }, {
      strategies: [strategy],
      tenant: { extract: (auth: { org: string }) => auth.org },
    });
    const input = await serve({}, api);
    await expect(input.authenticate(request('good'))).resolves.toEqual({ subject: 'u1', tenantId: 'acme' });
    await expect(input.authenticate(request())).resolves.toBeNull();
    const executor = await input.createExecutor({ subject: 'u1', tenantId: 'acme' });
    expect(typeof executor.listTools).toBe('function');
  });

  it("refuses to verify callers when a dataset's own access rules would be skipped", async () => {
    const api = apiWithDatasets({ orders: { name: 'orders' }, finance: { name: 'finance' } }, {
      strategies: [async () => ({ userId: 'u1' })],
    }, [
      { kind: 'dataset', name: 'finance', rules: ['requiredRoles', 'requiredScopes'] },
      { kind: 'metric', name: 'revenue', rules: ['auth'] },
    ]);
    const serveHttp = vi.fn(async (_input: RunMcpHttpServerInput) => undefined);
    await expect(mcpCommand(await entrypointFile(), { http: true }, {
      loadApi: async () => api, loadMcp: async () => mcpPackage, serveHttp, env: {},
    })).rejects.toThrow('process.exit:1');
    expect(serveHttp).not.toHaveBeenCalled();
    expect(logger.error).toHaveBeenCalledWith(
      '--http cannot apply the access rules these entries declare: finance (requiredRoles, requiredScopes), metric revenue (auth)',
    );
    expect(logger.indent).toHaveBeenCalledWith(expect.stringContaining('HYPEQUERY_MCP_KEY'));
  });

  it('serves those entries behind the one trusted key, which is a deliberate single principal', async () => {
    const api = apiWithDatasets({ finance: { name: 'finance' } }, {
      strategies: [async () => ({ userId: 'u1' })],
    }, [{ kind: 'dataset', name: 'finance', rules: ['requiredRoles'] }]);
    const input = await serve({}, api, { HYPEQUERY_MCP_KEY: KEY });
    await expect(input.authenticate(request(KEY))).resolves.toMatchObject({ subject: 'static-key' });
    // The holders of the shared key are told that the entry's own rules do not apply to them.
    expect(stderr).toHaveBeenCalledWith(expect.stringContaining('every holder of HYPEQUERY_MCP_KEY can query finance'));
  });

  it('refuses an OAuth resource that a JWT strategy would not insist on', async () => {
    const jwtStrategy = (audiences: string[]) => Object.assign(async () => null, {
      [Symbol.for('hypequery.jwt-audience.v1')]: { version: 1, audiences },
    });
    const flags = { http: true, resource: 'https://mcp.example.com/mcp', authorizationServers: 'https://auth.example.com' };
    const run = async (audiences: string[]) => {
      const serveHttp = vi.fn(async (_input: RunMcpHttpServerInput) => undefined);
      const outcome = mcpCommand(await entrypointFile(), flags, {
        loadApi: async () => apiWithDatasets({ orders: { name: 'orders' } }, { strategies: [jwtStrategy(audiences)] }),
        loadMcp: async () => mcpPackage, serveHttp, env: {},
      });
      return { outcome, serveHttp };
    };

    const accepted = await run(['https://mcp.example.com/mcp']);
    await accepted.outcome;
    expect(accepted.serveHttp).toHaveBeenCalledTimes(1);

    // A token naming only the other API would pass verification and open a session.
    const shared = await run(['https://mcp.example.com/mcp', 'https://api.example.com']);
    await expect(shared.outcome).rejects.toThrow('process.exit:1');
    expect(shared.serveHttp).not.toHaveBeenCalled();
    expect(logger.error).toHaveBeenCalledWith(expect.stringContaining('must accept only the audience'));
    expect(logger.indent).toHaveBeenCalledWith(expect.stringContaining('--resource'));

    const unchecked = await run([]);
    await expect(unchecked.outcome).rejects.toThrow('process.exit:1');
    expect(logger.error).toHaveBeenCalledWith(expect.stringContaining('any audience'));
  });

  it('refuses a caller without a tenant when a dataset is tenant-scoped', async () => {
    const api = apiWithDatasets({ orders: { name: 'orders', tenantKey: 'org_id' } }, {
      strategies: [async () => ({ userId: 'u1' })],
    });
    const input = await serve({}, api);
    await expect(input.authenticate(request('any'))).rejects.toMatchObject({ code: 'insufficient_scope' });
  });

  it('refuses to serve without any credential check', async () => {
    await expect(mcpCommand(await entrypointFile(), { http: true }, {
      loadApi: async () => apiWithDatasets({ orders: { name: 'orders' } }),
      loadMcp: async () => mcpPackage,
      env: {},
    })).rejects.toThrow('process.exit:1');
    expect(logger.error).toHaveBeenCalledWith(expect.stringContaining('HYPEQUERY_MCP_KEY'));
  });

  it('rejects --tenant with defineServe auth and HTTP flags without --http', async () => {
    const api = apiWithDatasets({ orders: { name: 'orders' } }, { strategies: [async () => null] });
    await expect(mcpCommand(await entrypointFile(), { http: true, tenant: 'acme' }, {
      loadApi: async () => api, loadMcp: async () => mcpPackage, env: {},
    })).rejects.toThrow('process.exit:1');
    await expect(mcpCommand(undefined, { port: '1234' }, {})).rejects.toThrow('process.exit:1');
    expect(logger.error).toHaveBeenCalledWith('--port is only used with --http.');
    await expect(mcpCommand(undefined, { http: true, selfTest: true }, {})).rejects.toThrow('process.exit:1');
  });

  it('bridges a client contract with the static key only, keeping the backend key separate', async () => {
    const serveHttp = vi.fn(async (_input: RunMcpHttpServerInput) => undefined);
    await mcpCommand(undefined, { http: true, clientContractUrl: 'https://py.example.test/client-contract' }, {
      loadMcp: async () => mcpPackage, serveHttp, env: { HYPEQUERY_MCP_KEY: KEY, HYPEQUERY_API_KEY: 'backend' },
    });
    const input = serveHttp.mock.calls[0][0];
    await expect(input.authenticate(request(KEY))).resolves.toMatchObject({ subject: 'static-key' });
    await expect(input.authenticate(request('backend'))).rejects.toMatchObject({ code: 'invalid_token' });

    await expect(mcpCommand(undefined, { http: true, clientContractUrl: 'https://py.example.test/client-contract' }, {
      loadMcp: async () => mcpPackage, serveHttp, env: {},
    })).rejects.toThrow('process.exit:1');
  });
});

describe('mcpHttpSettings', () => {
  it('derives allowed hosts from the bind address or the OAuth resource', () => {
    expect(mcpHttpSettings({ http: true, resource: 'https://mcp.example.com/mcp', authorizationServers: 'https://auth.example.com' }, {}))
      .toMatchObject({
        allowedHosts: ['mcp.example.com', 'localhost', '127.0.0.1', '[::1]'],
        oauth: { resource: 'https://mcp.example.com/mcp', authorizationServers: ['https://auth.example.com'] },
      });
    expect(mcpHttpSettings({ http: true, host: '0.0.0.0', allowedHosts: 'a.test, b.test', allowedOrigins: 'https://app.test' }, {}))
      .toMatchObject({ allowedHosts: ['a.test', 'b.test'], allowedOrigins: ['https://app.test'] });
  });

  it('rejects unsafe or incomplete settings', () => {
    expect(() => mcpHttpSettings({ http: true, host: '0.0.0.0' }, {})).toThrow(McpHttpUsageError);
    expect(() => mcpHttpSettings({ http: true, port: 'x' }, {})).toThrow(/--port/);
    expect(() => mcpHttpSettings({ http: true, resource: 'https://mcp.example.com/mcp' }, {})).toThrow(/--authorization-servers/);
    expect(() => mcpHttpSettings({
      http: true, resource: 'https://mcp.example.com/mcp', authorizationServers: 'https://a.test',
    }, { HYPEQUERY_MCP_KEY: KEY })).toThrow(/alternatives/);
  });
});
