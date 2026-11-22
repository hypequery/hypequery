/**
 * RFC 0026 query-scoped calculations through the data plane Cloud runs:
 * protocol validation, contract and visibility checks, the portable executor,
 * and the failure categories a caller sees.
 */

import { readFileSync } from 'node:fs';
import { createPortableSemanticExecutor } from '@hypequery/datasets';
import type { QueryBuilderFactoryLike, QueryBuilderLike } from '@hypequery/datasets';
import { describe, expect, it } from 'vitest';
import { createDeploymentSemanticDataPlane, DeploymentSemanticInvocationError } from './semantic-data-plane.js';

const REVISION = 'b'.repeat(64);
const ENDPOINT = {
  access: { kind: 'authenticated', roles: ['analyst'], scopes: [] },
  tenant: { kind: 'required', mode: 'auto-inject', column: 'tenant_id' },
  maxLimit: 500,
} as const;

function deployment() {
  const fixture = JSON.parse(readFileSync(
    new URL('../../../specs/datasets/contract-3-authoring-v1.json', import.meta.url), 'utf8',
  )) as { datasets: Record<string, unknown>[] };
  return { ...fixture, datasets: fixture.datasets.map(dataset => ({ ...dataset, endpoint: ENDPOINT })) };
}

function builderFactory() {
  const sql: string[] = [];
  const factory: QueryBuilderFactoryLike = {
    table(table: string) {
      const parts: string[] = [];
      const render = () => `SELECT ${parts.join(' ')} FROM ${table}`;
      const chain = new Proxy({} as QueryBuilderLike, {
        get: (_target, property: string) => {
          if (property === 'execute') return async () => { sql.push(render()); return []; };
          if (property === 'toSQLWithParams') return () => ({ sql: render(), parameters: [] });
          if (property === 'toSQL') return () => render();
          return (...args: unknown[]) => {
            parts.push(`${property}(${args.filter(a => a !== undefined).map(String).join(',')})`);
            return chain;
          };
        },
      });
      return chain;
    },
    rawQuery: async <T = Record<string, unknown>>(query: string): Promise<T[]> => {
      sql.push(query);
      return [] as T[];
    },
  };
  return { factory, sql };
}

function wire(visibility?: unknown) {
  const { factory, sql } = builderFactory();
  const plane = createDeploymentSemanticDataPlane({
    deployment: deployment() as never,
    activationRevision: REVISION,
    authenticate: async () => ({ subject: 'u1', roles: ['analyst'], scopes: [] }),
    resolveTenant: async () => 'acme',
    ...(visibility === undefined ? {} : { resolveFieldVisibility: async () => visibility }),
    execute: createPortableSemanticExecutor({ queryBuilder: factory }) as never,
  });
  return { plane, sql };
}

function invoke(plane: ReturnType<typeof wire>['plane'], operation: Record<string, unknown>, version: 1 | 2 = 2) {
  return plane.invoke({
    invocation: {
      kind: 'hypequery-semantic-invocation', version,
      target: { project: 'acme', environment: 'production' },
      operation: { kind: 'dataset', dataset: 'events', ...operation },
    },
    credentials: 'token',
  });
}

async function failure(promise: Promise<unknown>): Promise<DeploymentSemanticInvocationError> {
  const error = await promise.catch(caught => caught);
  expect(error).toBeInstanceOf(DeploymentSemanticInvocationError);
  return error as DeploymentSemanticInvocationError;
}

const RANGE = [{
  kind: 'comparison', operator: 'between',
  left: { kind: 'reference', name: 'occurredAt' },
  right: { kind: 'literal', value: { $hypequery: { type: 'tuple', version: 1, values: ['2026-01-01', '2026-03-01'] } } },
}];
const PAID = { kind: 'comparison', operator: 'eq', left: { kind: 'reference', name: 'status' }, right: { kind: 'literal', value: 'paid' } };

describe('RFC 0026 calculations through the data plane', () => {
  it.each([
    ['filter', { dimensions: ['plan'], measures: ['revenue'], calculations: [{ name: 'paid_revenue', filter: { measure: 'revenue', where: [PAID] } }] }, "'paid'"],
    ['shift', { measures: ['revenue'], by: 'week', filters: RANGE, calculations: [{ name: 'prior', shift: { measure: 'revenue', amount: 1, unit: 'week' } }] }, 'WITH'],
    ['window', { measures: ['revenue'], by: 'day', filters: RANGE, calculations: [{ name: 'r7', window: { measure: 'revenue', trailing: { amount: 7, unit: 'day' } } }] }, 'WITH'],
    ['formula', { measures: ['revenue', 'visitors'], calculations: [{ name: 'rpv', formula: { op: 'divide', args: ['revenue', { op: 'nullIfZero', args: ['visitors'] }] } }] }, 'NULLIF'],
    ['compare', { measures: ['revenue'], by: 'month', filters: RANGE, calculations: [{ name: 'mom', compare: { to: 'previousPeriod', measures: ['revenue'] } }] }, 'revenue_change_pct'],
  ] as const)('executes a %s calculation, tenant-scoped, under its own name', async (_kind, operation, marker) => {
    const { plane, sql } = wire();
    const result = await invoke(plane, operation as never);
    const text = sql.join('\n');
    expect(text).toContain(marker);
    expect(text).toContain('tenant_id');
    expect(result.meta.calculations?.length).toBeGreaterThan(0);
  });

  it('types every output column in the result metadata', async () => {
    const { plane } = wire();
    const result = await invoke(plane, {
      measures: ['revenue'], by: 'month', filters: RANGE,
      calculations: [
        { name: 'paid', filter: { measure: 'revenue', where: [PAID] } },
        { name: 'mom', compare: { to: 'previousPeriod', measures: ['revenue', 'paid'] } },
      ],
      having: [{ measure: 'revenue_change_pct', operator: 'gt', value: 0 }],
      orderBy: [{ field: 'paid_change', direction: 'desc' }],
    });
    expect(result.meta.calculations).toEqual([
      { name: 'paid', kind: 'filter', calculation: 'paid', measure: 'revenue', type: 'number' },
      { name: 'revenue_previous', kind: 'shift', calculation: 'mom', measure: 'revenue', type: 'number' },
      { name: 'revenue_change', kind: 'formula', calculation: 'mom', type: 'number' },
      { name: 'revenue_change_pct', kind: 'formula', calculation: 'mom', type: 'number', format: 'ratio' },
      { name: 'paid_previous', kind: 'shift', calculation: 'mom', measure: 'paid', type: 'number' },
      { name: 'paid_change', kind: 'formula', calculation: 'mom', type: 'number' },
      { name: 'paid_change_pct', kind: 'formula', calculation: 'mom', type: 'number', format: 'ratio' },
    ]);
  });

  it('refuses calculations in an invocation 1 record', async () => {
    const { plane, sql } = wire();
    const error = await failure(invoke(plane, { measures: ['revenue'], calculations: [] }, 1));
    expect(error.code).toBe('HQ_SEMANTIC_INVOCATION_INVALID');
    expect(sql).toHaveLength(0);
  });

  it('refuses a hidden input exactly as an unknown one', async () => {
    const operation = (measure: string) => ({
      measures: ['revenue'], calculations: [{ name: 'x', filter: { measure, where: [PAID] } }],
    });
    const unknown = await failure(invoke(wire().plane, operation('nope')));
    const { plane: narrowed, sql } = wire({
      kind: 'hypequery-field-visibility', version: 1,
      datasets: { events: { dimensions: '*', measures: ['revenue'] } },
    });
    const hidden = await failure(invoke(narrowed, operation('visitors')));
    expect([hidden.category, hidden.code, hidden.path]).toEqual([unknown.category, unknown.code, unknown.path]);
    expect(hidden.message).toBe(unknown.message.replace('nope', 'visitors'));
    expect(sql).toHaveLength(0);
  });

  it.each([
    ['filter of a window measure', { measures: ['revenue'], calculations: [{ name: 'x', filter: { measure: 'revenue7d', where: [PAID] } }] }, '$.operation.calculations[0].filter.measure'],
    ['filter condition on an unfilterable field', { measures: ['revenue'], calculations: [{ name: 'x', filter: { measure: 'revenue', where: [{ ...PAID, left: { kind: 'reference', name: 'nope' } }] } }] }, '$.operation.calculations[0].filter.where[0]'],
    ['filter condition on the time field', { measures: ['revenue'], calculations: [{ name: 'x', filter: { measure: 'revenue', where: [{ ...PAID, left: { kind: 'reference', name: 'occurredAt' }, right: { kind: 'literal', value: '2026-01-01' } }] } }] }, '$.operation.calculations[0].filter.where[0]'],
    ['shift of a shift measure', { measures: ['revenue'], by: 'week', filters: RANGE, calculations: [{ name: 'x', shift: { measure: 'revenuePriorWeek', amount: 1, unit: 'week' } }] }, '$.operation.calculations[0].shift.measure'],
    ['cumulative approxCountDistinct', { measures: ['revenue'], by: 'day', filters: RANGE, calculations: [{ name: 'x', window: { measure: 'visitors', cumulative: true } }] }, '$.operation.calculations[0].window.cumulative'],
    ['ordering by an unknown output', { measures: ['revenue'], calculations: [{ name: 'x', filter: { measure: 'revenue', where: [PAID] } }], orderBy: [{ field: 'y', direction: 'asc' }] }, '$.operation.orderBy[0].field'],
  ] as const)('refuses %s as input-invalid at its path', async (_name, operation, path) => {
    const { plane, sql } = wire();
    const error = await failure(invoke(plane, operation as never));
    expect([error.category, error.path]).toEqual(['input-invalid', path]);
    expect(sql).toHaveLength(0);
  });

  it('refuses what only the planner can check as input-invalid, never as an executor failure', async () => {
    const { plane, sql } = wire();
    const error = await failure(invoke(plane, {
      measures: ['revenue'], by: 'week', calculations: [{ name: 'p', shift: { measure: 'revenue', amount: 1, unit: 'week' } }],
    }));
    expect([error.category, error.code]).toEqual(['input-invalid', 'HQ_SEMANTIC_INPUT_INVALID']);
    expect(error.message).toMatch(/bounded time range/);
    expect(sql).toHaveLength(0);
  });

  it.each([
    ['rank', { dimensions: ['plan'], measures: ['revenue'], calculations: [{ name: 'r', rank: { measure: 'revenue' } }] }, 'rank()', 1],
    ['additive share', { dimensions: ['plan'], measures: ['revenue'], calculations: [{ name: 's', share: { measure: 'revenue' } }] }, 'OVER ()', 1],
    ['non-additive share', { dimensions: ['plan'], measures: ['visitors'], calculations: [{ name: 's', share: { measure: 'visitors' } }] }, 'CROSS JOIN', 2],
    ['limitBy', { dimensions: ['plan', 'status'], measures: ['revenue'], orderBy: [{ field: 'revenue', direction: 'desc' }], limitBy: { n: 2, by: ['plan'] } }, 'LIMIT 2 BY', 1],
    ['other', { dimensions: ['plan'], measures: ['revenue'], other: { dimension: 'plan', n: 3, measure: 'revenue' } }, '_hq_other_top', 2],
  ] as const)('executes %s, tenant-scoped in every embedded statement', async (_name, operation, marker, statements) => {
    const { plane, sql } = wire();
    await invoke(plane, operation as never);
    const text = sql.join('\n');
    expect(text).toContain(marker);
    // The top-N and denominator statements carry tenancy too.
    expect(text.match(/tenant_id/g)).toHaveLength(statements);
  });

  it('refuses other on a dimension that is not a string', async () => {
    const error = await failure(invoke(wire().plane, {
      dimensions: ['amount'], measures: ['revenue'], other: { dimension: 'amount', n: 3, measure: 'revenue' },
    }));
    expect([error.category, error.path]).toEqual(['input-invalid', '$.operation.other.dimension']);
  });
});
