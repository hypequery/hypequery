import { mkdtemp, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../utils/logger.js', () => ({
  logger: { error: vi.fn(), info: vi.fn(), success: vi.fn(), warn: vi.fn(), indent: vi.fn(), newline: vi.fn() },
}));

import { logger } from '../utils/logger.js';
import { checkCommand } from './check.js';
import type { ExplainStatement } from '../utils/check/run-check.js';

const mcpSourceSymbol = Symbol.for('hypequery.mcp-source.v1');

function apiWithDatasets(datasets: Record<string, unknown>, analytics: unknown) {
  const api = {};
  Object.defineProperty(api, mcpSourceSymbol, {
    value: { version: 1, datasets, resolveAnalytics: () => analytics },
    enumerable: false,
  });
  return api;
}

async function entrypointFile(): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'hq-check-'));
  const file = path.join(dir, 'api.ts');
  await writeFile(file, 'export const api = {};\n', 'utf8');
  return file;
}

describe('hypequery check', () => {
  let exit: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    exit = vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
      throw new Error(`process.exit:${code ?? 0}`);
    }) as never);
  });

  afterEach(() => { exit.mockRestore(); });

  const compileDataset = vi.fn((_dataset: unknown, query: unknown) => ({
    sql: JSON.stringify(query), parameters: [], preflightStatements: [],
  }));

  it('compiles tenant-scoped datasets with a tenant and passes when every query plans', async () => {
    const withExplainer = vi.fn(async (_db: string, _entry: string, work: (explain: ExplainStatement) => Promise<never>) =>
      work(async () => []));
    await checkCommand(await entrypointFile(), { database: 'postgres', tenant: 'acme' }, {
      loadApi: async () => apiWithDatasets(
        { orders: { tenantKey: 'tenant_id', dimensions: { status: {} }, measures: { revenue: {} } } },
        { compileDataset },
      ),
      withExplainer: withExplainer as never,
    });
    expect(withExplainer).toHaveBeenCalledWith('postgres', expect.any(String), expect.any(Function));
    expect(compileDataset).toHaveBeenCalledWith(expect.anything(), { measures: ['revenue'] }, { runtime: { tenant: { id: 'acme' } } });
    expect(logger.success).toHaveBeenCalledWith('orders: 2 queries planned');
    expect(exit).not.toHaveBeenCalled();
  });

  it('exits 1 and names the failing query when one does not plan', async () => {
    const withExplainer = async (_db: string, _entry: string, work: (explain: ExplainStatement) => Promise<never>) =>
      work(async ({ sql }) => { if (sql.includes('status')) throw new Error('column "status" does not exist'); return []; });
    await expect(checkCommand(await entrypointFile(), { database: 'postgres' }, {
      loadApi: async () => apiWithDatasets({ orders: { dimensions: { status: {} }, measures: { revenue: {} } } }, { compileDataset }),
      withExplainer: withExplainer as never,
    })).rejects.toThrow('process.exit:1');
    expect(logger.indent).toHaveBeenCalledWith('dimension status (plan): column "status" does not exist');
  });

  it('reports an entrypoint that fails to load, such as a dataset its engine refuses', async () => {
    await expect(checkCommand(await entrypointFile(), { database: 'postgres' }, {
      loadApi: async () => { throw new Error('Dataset "orders" uses measure.merge, which Postgres cannot run.'); },
    })).rejects.toThrow('process.exit:1');
    expect(vi.mocked(logger.error).mock.calls[0]![0]).toMatch(/failed to load: Dataset "orders" uses measure.merge/);
  });

  it('refuses an unknown engine', async () => {
    await expect(checkCommand(await entrypointFile(), { database: 'mysql' })).rejects.toThrow(/Unsupported database "mysql" for check/);
  });
});
