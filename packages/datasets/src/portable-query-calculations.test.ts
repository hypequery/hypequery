/**
 * RFC 0026 calculations through the portable runtime: the protocol shapes the
 * data plane hands over, the claimed failure categories, and result metadata.
 */

import { validateProtocolDeploymentContract, validateProtocolSemanticQuery } from '@hypequery/protocol';
import { describe, expect, it } from 'vitest';
import {
  createPortableSemanticRuntime,
  PortableExecutionInputError,
  type PortableSemanticExecutionInput,
} from './portable-executor.js';
import type { QueryBuilderFactoryLike, QueryBuilderLike } from './query-builder-protocol.js';
import { clickhouseDatasetSqlDialect } from './utils/clickhouse-dataset-sql-dialect.js';
import { defineDatasetSqlDialectRules } from './utils/dataset-sql-dialect.js';
import { UNSUPPORTED_CONTRACT_REASONS } from './utils/unsupported-contract-reasons.js';

const REVISION = 'c'.repeat(64);

function deployment() {
  return validateProtocolDeploymentContract({
    kind: 'hypequery-deployment',
    version: 2,
    datasets: [{
      name: 'orders',
      source: 'analytics.orders',
      tenant: { kind: 'required', field: 'tenant_id' },
      timeField: 'createdAt',
      dimensions: [
        { name: 'createdAt', type: 'timestamp', source: { kind: 'column', column: 'created_at' }, filterable: true, groupable: true },
        { name: 'status', type: 'string', source: { kind: 'column', column: 'status' }, filterable: true, groupable: true },
        { name: 'amount', type: 'number', source: { kind: 'column', column: 'amount' }, filterable: false, groupable: false },
      ],
      measures: [
        { name: 'revenue', aggregation: 'sum', field: 'amount', filters: [] },
        { name: 'orderCount', aggregation: 'count', field: 'status', filters: [] },
      ],
      filters: [{ name: 'status', field: 'status', operators: ['eq', 'in'] }],
      relationships: [],
      endpoint: {
        access: { kind: 'authenticated', roles: [], scopes: [] },
        tenant: { kind: 'required', mode: 'auto-inject', column: 'tenant_id' },
      },
    }],
  });
}

function recordingFactory() {
  const sql: string[] = [];
  const factory: QueryBuilderFactoryLike = {
    table(table: string) {
      const parts: string[] = [];
      const chain = new Proxy({} as QueryBuilderLike, {
        get(_target, property: string) {
          if (property === 'toSQLWithParams') return () => ({ sql: `SELECT ${parts.join(' ')} FROM ${table}`, parameters: [] });
          if (property === 'execute') return async () => [];
          return (...args: unknown[]) => {
            parts.push(`${property}(${args.filter(a => a !== undefined).map(String).join(',')})`);
            return chain;
          };
        },
      });
      return chain;
    },
    rawQuery: async <T>(query: string) => {
      sql.push(query);
      return [{ status: 'paid', revenue: 10, paid: 4 }] as T[];
    },
  };
  return { factory, sql };
}

function input(operation: Record<string, unknown>): PortableSemanticExecutionInput {
  const contract = deployment();
  return {
    deployment: contract,
    dataset: contract.datasets[0],
    operation: validateProtocolSemanticQuery({ kind: 'dataset', dataset: 'orders', ...operation }, { extension: 2 }),
    tenant: 'acme',
    budget: { maxRows: 100 },
    activationRevision: REVISION,
  } as unknown as PortableSemanticExecutionInput;
}

const PAID = {
  kind: 'comparison', operator: 'in',
  left: { kind: 'reference', name: 'status' },
  right: { kind: 'literal', value: { $hypequery: { type: 'array', version: 1, values: ['paid', 'shipped'] } } },
};
const RANGE = {
  kind: 'comparison', operator: 'between',
  left: { kind: 'reference', name: 'createdAt' },
  right: { kind: 'literal', value: { $hypequery: { type: 'tuple', version: 1, values: ['2026-01-01', '2026-04-01'] } } },
};

describe('RFC 0026 calculations through the portable runtime', () => {
  it('rehydrates filter conditions and returns typed calculation metadata', async () => {
    const { factory, sql } = recordingFactory();
    const runtime = createPortableSemanticRuntime({ queryBuilder: factory });
    const operation = {
      dimensions: ['status'], measures: ['revenue', 'orderCount'],
      calculations: [
        { name: 'paid', filter: { measure: 'revenue', where: [PAID] } },
        { name: 'paid_per_order', formula: { op: 'round', args: [{ op: 'divide', args: ['paid', { op: 'nullIfZero', args: ['orderCount'] }] }, 2] } },
      ],
    };
    const result = await runtime.execute(input(operation));
    expect(sql[0]).toContain("IN ('paid', 'shipped')");
    expect(result.meta.calculations).toEqual([
      { name: 'paid', kind: 'filter', calculation: 'paid', measure: 'revenue', type: 'number' },
      { name: 'paid_per_order', kind: 'formula', calculation: 'paid_per_order', type: 'number' },
    ]);
    expect(runtime.compile(input(operation)).describe().calculations).toEqual(['paid', 'paid_per_order']);
  });

  it('compiles a time-measure calculation with its axis preflight', () => {
    const { factory } = recordingFactory();
    const compilation = createPortableSemanticRuntime({ queryBuilder: factory }).compile(input({
      measures: ['revenue'], by: 'month', filters: [RANGE],
      calculations: [{ name: 'mom', compare: { to: 'previousPeriod', measures: ['revenue'] } }],
    }));
    expect(compilation.describe()).toMatchObject({ plan: 'time', preflightStatementCount: 1 });
    expect(compilation.preflightStatements).toHaveLength(1);
    expect(compilation.sql).toContain('`_hq_calc_0_0_change_pct` AS `revenue_change_pct`');
  });

  it('resolves a relative range before checking a calculated query', async () => {
    const { factory, sql } = recordingFactory();
    const runtime = createPortableSemanticRuntime({ queryBuilder: factory, now: () => new Date('2026-11-22T10:00:00Z') });
    const thisYear = {
      kind: 'comparison', operator: 'inDateRange',
      left: { kind: 'reference', name: 'createdAt' }, right: { kind: 'literal', value: 'this year' },
    };
    const operation = {
      measures: ['revenue'], by: 'month', filters: [thisYear],
      calculations: [{ name: 'mom', compare: { to: 'previousPeriod', measures: ['revenue'] } }],
    };
    await runtime.execute(input(operation));
    expect(sql.length).toBeGreaterThan(0);
    expect(runtime.compile(input(operation)).parameters).toEqual(expect.arrayContaining(['2026-01-01', '2027-01-01']));
  });

  it('claims input-invalid for what the dataset cannot satisfy', () => {
    const runtime = createPortableSemanticRuntime({ queryBuilder: recordingFactory().factory });
    expect(() => runtime.compile(input({
      measures: ['revenue'], by: 'month',
      calculations: [{ name: 'p', shift: { measure: 'revenue', amount: 1, unit: 'month' } }],
    }))).toThrow(PortableExecutionInputError);
    const error = (() => {
      try {
        runtime.compile(input({ measures: ['revenue'], calculations: [{ name: 'x', filter: { measure: 'nope', where: [PAID] } }] }));
      } catch (caught) {
        return caught as Error;
      }
      throw new Error('expected a refusal');
    })();
    expect(error).toMatchObject({ category: 'input-invalid', code: 'HQ_SEMANTIC_INPUT_INVALID', hypequerySemanticFailure: true });
    expect(error.message).toMatch(/unknown measure "nope"/);
  });

  it('executes rank, share, limitBy and other, with every output typed', async () => {
    const { factory, sql } = recordingFactory();
    const result = await createPortableSemanticRuntime({ queryBuilder: factory }).execute(input({
      dimensions: ['status'], measures: ['revenue', 'orderCount'],
      calculations: [
        { name: 'r', rank: { measure: 'revenue' } },
        { name: 's', share: { measure: 'revenue' } },
      ],
      orderBy: [{ field: 'r', direction: 'asc' }],
      limitBy: { n: 1, by: ['status'] },
      other: { dimension: 'status', n: 2, measure: 'orderCount' },
    }));
    expect(sql[0]).toMatch(/^WITH `_hq_other_top` AS /);
    expect(sql[0]).toContain('LIMIT 1 BY `status`');
    expect(result.meta.calculations?.map(column => [column.name, column.kind, column.type])).toEqual([
      ['r', 'rank', 'integer'], ['s', 'share', 'number'],
    ]);
  });

  it('claims unsupported-capability, with a reason, for stage features the dialect cannot run', async () => {
    const { factory, sql } = recordingFactory();
    const elsewhere = defineDatasetSqlDialectRules({ ...clickhouseDatasetSqlDialect, name: 'elsewhere' });
    const runtime = createPortableSemanticRuntime({ queryBuilder: { ...factory, datasetSqlDialect: elsewhere } });
    const error = await runtime.execute(input({
      dimensions: ['status'], measures: ['revenue'], other: { dimension: 'status', n: 2, measure: 'revenue' },
    })).catch(caught => caught as Error);
    expect(error).toMatchObject({
      category: 'unsupported-capability', code: 'HQ_SEMANTIC_UNSUPPORTED_CAPABILITY',
      reason: UNSUPPORTED_CONTRACT_REASONS.queryCalculationDialect,
      message: '"other" is not supported on the "elsewhere" dialect.',
    });
    expect(sql).toHaveLength(0);
    // What the dialect does run is unaffected.
    expect(runtime.compile(input({
      dimensions: ['status'], measures: ['revenue'], calculations: [{ name: 's', share: { measure: 'revenue' } }],
    })).sql).toContain('OVER ()');
  });
});
