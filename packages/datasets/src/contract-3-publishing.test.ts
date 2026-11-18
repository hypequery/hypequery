import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { validateProtocolDeploymentContractV3 } from '@hypequery/protocol';
import { between, buildProtocolDeploymentContract, createDatasetClient, dataset, dimension, measure, rehydrateProtocolDeploymentContract, UNSUPPORTED_CONTRACT_REASONS, UnsupportedContractFeatureError } from './index.js';
import type { DatasetQuery } from './types.js';
import { contract3AuthoringDataset as Events } from './contract-3-authoring.fixture.js';
import { createRenderingBuilderFactory } from './tests/support/sql-equality-harness.js';

const fixture = JSON.parse(readFileSync(
  new URL('../../../specs/datasets/contract-3-authoring-v1.json', import.meta.url), 'utf8',
)) as Record<string, unknown>;

function factory() {
  const rendering = createRenderingBuilderFactory();
  const table = rendering.table;
  rendering.table = name => {
    const builder = table(name);
    builder.approxCountDistinct = (column, alias) => builder.select(`uniq(${column}) AS ${alias}`);
    return builder;
  };
  return rendering;
}

const range = [between('occurredAt', '2026-01-01', '2026-01-15')];

/** One query per contract 3 feature, plus combinations a caller is likely to send. */
const QUERIES: Record<string, DatasetQuery> = {
  segment: { measures: ['revenue'], segments: ['enterprise'] },
  conjunctiveSegment: { measures: ['revenue'], dimensions: ['plan'], segments: ['bigPaid', 'enterprise'] },
  approx: { measures: ['visitors'], dimensions: ['status'] },
  approxDerived: { measures: ['revenuePerVisitor'] },
  hourly: { measures: ['revenue'], by: 'hour', filters: range },
  minutely: { measures: ['visitors'], by: 'minute', filters: range },
  trailing: { measures: ['revenue7d'], by: 'day', filters: range },
  toDate: { measures: ['revenueMtd'], by: 'day', filters: range },
  cumulative: { measures: ['revenueRunning'], by: 'day', filters: range },
  approxWindow: { measures: ['visitors7d'], by: 'day', filters: range },
  shift: { measures: ['revenuePriorWeek'], by: 'week', filters: range },
  growth: { measures: ['revenue', 'revenueGrowth'], by: 'week', filters: range, segments: ['enterprise'] },
};

describe('publishing contract 3 (RFC 0015)', () => {
  it('emits the contract Python emits for the same definition', () => {
    expect(buildProtocolDeploymentContract([Events])).toEqual(fixture);
    expect(() => validateProtocolDeploymentContractV3(fixture)).not.toThrow();
  });

  it.each(Object.entries(QUERIES))('rebuilds %s to byte-identical SQL', (_name, query) => {
    const rebuilt = rehydrateProtocolDeploymentContract(fixture).events!;
    const client = createDatasetClient({ queryBuilder: factory() });
    const context = { runtime: { tenant: 'tenant-a' } };
    const authored = client.compileDataset(Events, query, context);
    const replayed = client.compileDataset(rebuilt, query, context);
    expect(authored.sql).toContain('tenant_id');
    expect(replayed.sql).toBe(authored.sql);
    expect(replayed.parameters).toEqual(authored.parameters);
    expect(replayed.preflightStatements.map(statement => statement.sql))
      .toEqual(authored.preflightStatements.map(statement => statement.sql));
  });

  it('round-trips: a rebuilt dataset publishes the same contract', () => {
    const rebuilt = rehydrateProtocolDeploymentContract(fixture).events!;
    expect(buildProtocolDeploymentContract([rebuilt])).toEqual(fixture);
  });

  it('keeps contract 2 for a deployment with no contract 3 feature', () => {
    const plain = dataset('orders', {
      source: 'orders', timeKey: 'createdAt',
      dimensions: { createdAt: dimension.timestamp(), amount: dimension.number() },
      measures: { revenue: measure.sum('amount') },
    });
    expect(buildProtocolDeploymentContract([plain]).version).toBe(2);
    // One contract 3 dataset moves the whole deployment.
    expect(buildProtocolDeploymentContract([plain, Events]).version).toBe(3);
  });

  it('refuses a segment predicate no local segment can express', () => {
    const datasets = (fixture.datasets as Record<string, unknown>[]).map(entry => ({
      ...entry,
      segments: [{
        name: 'either',
        predicate: { kind: 'logical', operator: 'or', operands: [
          { kind: 'comparison', operator: 'eq', left: { kind: 'reference', name: 'plan' }, right: { kind: 'literal', value: 'pro' } },
          { kind: 'comparison', operator: 'eq', left: { kind: 'reference', name: 'status' }, right: { kind: 'literal', value: 'paid' } },
        ] },
      }],
    }));
    let error: unknown;
    try {
      rehydrateProtocolDeploymentContract({ ...fixture, datasets });
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(UnsupportedContractFeatureError);
    expect((error as UnsupportedContractFeatureError).reason)
      .toBe(UNSUPPORTED_CONTRACT_REASONS.segmentPredicateNotConjunction);
  });

  it('publishes a range segment with tuple bounds, as Python does', () => {
    const ranged = dataset('orders', {
      source: 'orders', timeKey: 'createdAt',
      dimensions: { createdAt: dimension.timestamp(), amount: dimension.number() },
      measures: { revenue: measure.sum('amount') },
      segments: { midTier: { filters: [between('amount', 100, 200)] } },
    });
    const contract = buildProtocolDeploymentContract([ranged]);
    expect(contract.version).toBe(3);
    expect(() => validateProtocolDeploymentContractV3(contract)).not.toThrow();
    const [entry] = contract.datasets as unknown as { segments: unknown[] }[];
    // `tests/test_contract_3_authoring.py` pins the same predicate for Python.
    expect(entry!.segments).toEqual([{
      name: 'midTier',
      predicate: {
        kind: 'comparison',
        operator: 'between',
        left: { kind: 'reference', name: 'amount' },
        right: { kind: 'literal', value: { $hypequery: { type: 'tuple', version: 1, values: [100, 200] } } },
      },
    }]);
    const rebuilt = rehydrateProtocolDeploymentContract(contract).orders!;
    const client = createDatasetClient({ queryBuilder: factory() });
    const query: DatasetQuery = { measures: ['revenue'], segments: ['midTier'] };
    expect(client.compileDataset(rebuilt, query).sql).toBe(client.compileDataset(ranged, query).sql);
  });
});
