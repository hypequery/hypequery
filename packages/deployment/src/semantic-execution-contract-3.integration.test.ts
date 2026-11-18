/**
 * K-01: contract 3 features (RFC 0015) through the data plane Cloud runs.
 *
 * The deployment is the shared authoring fixture TypeScript and Python both
 * publish, with an endpoint added. Each feature is invoked through the data
 * plane and executed by the injected portable executor, so this covers
 * validation, visibility, rehydration and planning together.
 */

import { readFileSync } from 'node:fs';
import { createPortableSemanticExecutor } from '@hypequery/datasets';
import type { QueryBuilderFactoryLike, QueryBuilderLike } from '@hypequery/datasets';
import { describe, expect, it } from 'vitest';
import { createDeploymentSemanticDataPlane, DeploymentSemanticInvocationError } from './semantic-data-plane.js';
import { projectAuthorizedDeploymentContract } from './authorized-contract.js';

const REVISION = 'a'.repeat(64);
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

function invoke(plane: ReturnType<typeof wire>['plane'], operation: Record<string, unknown>, version: 1 | 2 = 1) {
  return plane.invoke({
    invocation: {
      kind: 'hypequery-semantic-invocation', version,
      target: { project: 'acme', environment: 'production' },
      operation: { kind: 'dataset', dataset: 'events', ...operation },
    },
    credentials: 'token',
  });
}

const RANGE = [{
  kind: 'comparison', operator: 'between',
  left: { kind: 'reference', name: 'occurredAt' },
  right: { kind: 'literal', value: { $hypequery: { type: 'tuple', version: 1, values: ['2026-01-01', '2026-01-15'] } } },
}];

describe('contract 3 through the data plane', () => {
  it.each([
    ['a segment', { measures: ['revenue'], segments: ['enterprise'] }, 2, 'plan,eq,enterprise'],
    ['an hourly bucket', { measures: ['revenue'], by: 'hour', filters: RANGE }, 2, 'toStartOfHour'],
    ['a minute bucket', { measures: ['revenue'], by: 'minute', filters: RANGE }, 2, 'toStartOfMinute'],
    ['approxCountDistinct', { measures: ['visitors'] }, 1, 'approxCountDistinct'],
    ['a trailing window', { measures: ['revenue7d'], by: 'day', filters: RANGE }, 1, 'WITH'],
    ['a to-date window', { measures: ['revenueMtd'], by: 'day', filters: RANGE }, 1, 'WITH'],
    ['a cumulative window', { measures: ['revenueRunning'], by: 'day', filters: RANGE }, 1, 'WITH'],
    ['a shift and a growth formula', { measures: ['revenueGrowth'], by: 'week', filters: RANGE }, 1, 'WITH'],
  ] as const)('executes %s', async (_name, operation, version, marker) => {
    const { plane, sql } = wire();
    const result = await invoke(plane, operation, version);
    expect(result.activationRevision).toBe(REVISION);
    expect(sql.join('\n')).toContain(marker);
    expect(sql.join('\n')).toContain('tenant_id');
  });

  it('refuses segments and sub-day grains in an invocation 1 record', async () => {
    const { plane, sql } = wire();
    await expect(invoke(plane, { measures: ['revenue'], segments: ['enterprise'] }, 1))
      .rejects.toMatchObject({ code: 'HQ_SEMANTIC_INVOCATION_INVALID' });
    await expect(invoke(plane, { measures: ['revenue'], by: 'hour', filters: RANGE }, 1))
      .rejects.toMatchObject({ code: 'HQ_SEMANTIC_INVOCATION_INVALID' });
    expect(sql).toHaveLength(0);
  });

  it('refuses an unknown segment, and a hidden one exactly like it', async () => {
    const { plane } = wire();
    const unknown = await invoke(plane, { measures: ['revenue'], segments: ['nope'] }, 2).catch(error => error);
    expect(unknown).toBeInstanceOf(DeploymentSemanticInvocationError);

    // `plan` is hidden, so `enterprise` (plan = 'enterprise') is too.
    const { plane: narrowed, sql } = wire({
      kind: 'hypequery-field-visibility', version: 1,
      datasets: { events: { dimensions: ['amount', 'occurredAt', 'status', 'userId'], measures: '*' } },
    });
    const hidden = await invoke(narrowed, { measures: ['revenue'], segments: ['enterprise'] }, 2).catch(error => error);
    expect(hidden).toBeInstanceOf(DeploymentSemanticInvocationError);
    expect((hidden as DeploymentSemanticInvocationError).message).toBe((unknown as DeploymentSemanticInvocationError).message.replace('nope', 'enterprise'));
    await invoke(narrowed, { measures: ['revenue'], segments: ['bigPaid'] }, 2);
    expect(sql).toHaveLength(1);
  });

  it('projects a contract 3 for a principal, lowering it when nothing contract 3 is visible', () => {
    const principal = { subject: 'u1', roles: ['analyst'], scopes: [] };
    const full = projectAuthorizedDeploymentContract(deployment() as never, principal);
    expect(full.contract.version).toBe(3);
    const lowered = projectAuthorizedDeploymentContract(deployment() as never, principal, {
      visibility: {
        kind: 'hypequery-field-visibility', version: 1,
        // No segment's dimensions and no contract 3 measure are visible.
        datasets: { events: { dimensions: ['occurredAt', 'userId'], measures: ['revenue'] } },
      },
    });
    expect(lowered.contract.version).toBe(2);
    expect('filters' in lowered.contract.datasets[0]!).toBe(true);
    expect(lowered.queryable).toEqual(['events']);
  });
});
