import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseProtocolIdentifier, parseProtocolQualifiedIdentifier, validateProtocolDeploymentContractV3 } from '@hypequery/protocol';
import capabilitySource from './execution-capabilities.json' with { type: 'json' };
import { add, between, buildProtocolDeploymentContract, createDatasetClient, createPortableSemanticRuntime, DATASET_EXECUTION_CAPABILITIES, dataset, dimension, eq, measure, publishToCloud, rehydrateProtocolDeploymentContract, UnsupportedContractFeatureError } from './index.js';
import type { DatasetQuery, DatasetMeasureDefinition } from './types.js';
import { createRenderingBuilderFactory } from './tests/support/sql-equality-harness.js';

// Concrete probes for each advertised feature; adding a row requires a probe.
function featureDataset(feature: string) {
  const measures: Record<string, DatasetMeasureDefinition> = { revenue: measure.sum('amount') };
  if (feature === 'derivedMeasures') measures.value = measure.derived({ uses: { revenue: 'revenue' }, formula: ({ revenue }) => add(revenue, revenue) });
  if (feature === 'windowMeasures') measures.value = measure.cumulative('revenue');
  if (feature === 'shiftMeasures') measures.value = measure.shift('revenue', { amount: 1, unit: 'day' });
  if (feature === 'approxCountDistinct') measures.value = measure.approxCountDistinct('amount');
  return dataset('orders', {
    source: 'orders', timeKey: 'createdAt',
    dimensions: { amount: dimension.number(), status: dimension.string(), createdAt: dimension.timestamp() },
    measures,
    ...(feature === 'segments' ? { segments: { paid: { filters: [eq('status', 'paid')] } } } : {}),
  });
}

/** What each feature leaves in the compiled SQL, so a probe cannot pass by ignoring it. */
const SQL_MARKERS: Record<string, string> = {
  baseMeasures: 'SUM(', derivedMeasures: 'SUM(', segments: "'paid'", windowMeasures: 'WITH',
  shiftMeasures: 'WITH', approxCountDistinct: 'uniq(', subDayGrains: 'toStartOfHour',
};

describe('dataset execution capability matrix', () => {
  const features = DATASET_EXECUTION_CAPABILITIES.features;
  it('covers every declared feature exactly once and freezes discovery data', () => {
    // The deprecated `cloud` and `cloudDeploymentVersion` are aliases, not matrix data (RFC 0030).
    const { cloudDeploymentVersion, features: withAliases, ...rest } = DATASET_EXECUTION_CAPABILITIES;
    expect({ ...rest, features: withAliases.map(({ cloud: _cloud, ...entry }) => entry) }).toEqual(capabilitySource);
    expect(withAliases.every(entry => entry.cloud === entry.portable)).toBe(true);
    expect(cloudDeploymentVersion).toBe(3);
    expect(capabilitySource).not.toHaveProperty('cloudDeploymentVersion');
    expect(features.map(entry => entry.feature).sort()).toEqual(['baseMeasures', 'derivedMeasures', 'segments', 'windowMeasures', 'shiftMeasures', 'approxCountDistinct', 'subDayGrains'].sort());
    expect(Object.isFrozen(features[0]!.typescript)).toBe(true);
  });

  it.each(features)('$feature matches TS authoring, publishing and portable execution', async entry => {
    const ds = featureDataset(entry.feature);
    const factory = createRenderingBuilderFactory();
    const table = factory.table;
    factory.table = name => {
      const builder = table(name);
      builder.approxCountDistinct = (column, alias) => builder.select(`uniq(${column}) AS ${alias}`);
      return builder;
    };
    const query: DatasetQuery = {
      measures: entry.feature === 'baseMeasures' || entry.feature === 'segments' || entry.feature === 'subDayGrains' ? ['revenue'] : ['value'],
      ...(entry.feature === 'segments' ? { segments: ['paid'] } : {}),
      ...(entry.feature === 'subDayGrains' ? { by: 'hour' as const } : {}),
      ...(entry.feature === 'windowMeasures' || entry.feature === 'shiftMeasures'
        ? { by: 'day' as const, filters: [between('createdAt', '2026-01-01', '2026-01-03')] } : {}),
    };
    const client = createDatasetClient({ queryBuilder: factory });
    expect(() => client.compileDataset(ds, query)).not.toThrow();
    expect(entry.typescript.local).toBe(true);
    const publish = () => publishToCloud({ datasets: { orders: ds }, access: { roles: [], scopes: [] } });
    expect(entry.typescript.publish).toBe(true);
    expect(entry.portable).toBe(true);
    const deployment = publish();
    // Lowest-version rule: contract 3 only when the dataset needs it.
    expect(deployment.version).toBe(entry.protocolVersions.includes(2) || entry.feature === 'subDayGrains' ? 2 : 3);
    expect(Object.keys(rehydrateProtocolDeploymentContract(deployment))).toEqual(['orders']);
    const runtime = createPortableSemanticRuntime({ queryBuilder: factory });
    const operation = {
      kind: 'dataset' as const,
      dataset: deployment.datasets[0]!.name,
      measures: query.measures?.map(parseProtocolIdentifier),
      ...(query.segments ? { segments: query.segments.map(parseProtocolIdentifier) } : {}),
      ...(query.by ? { by: query.by } : {}),
      ...(entry.feature === 'windowMeasures' || entry.feature === 'shiftMeasures' ? {
        filters: [{
          kind: 'comparison' as const, operator: 'between' as const,
          left: { kind: 'reference' as const, name: parseProtocolQualifiedIdentifier('createdAt') },
          right: { kind: 'literal' as const, value: { $hypequery: { type: 'tuple', version: 1, values: ['2026-01-01', '2026-01-03'] } } },
        }],
      } : {}),
    };
    const input = {
      deployment, dataset: deployment.datasets[0]!, tenant: undefined,
      operation: operation as never,
      activationRevision: 'a'.repeat(64), budget: { maxRows: 100 },
    };
    const compiled = runtime.compile(input);
    expect(compiled.describe().measures).toEqual(query.measures);
    if (entry.feature === 'segments') expect(compiled.describe().segments).toEqual(['paid']);
    expect(compiled.sql).toContain(SQL_MARKERS[entry.feature]);
    expect((await runtime.execute(input)).activationRevision).toBe(input.activationRevision);
  });

  it('keeps v3 conformance fixtures that a local segment can express rehydratable', () => {
    const fixtures = JSON.parse(readFileSync(new URL('../../../specs/security-protocol/fixtures/deployments-v3/success.json', import.meta.url), 'utf8')) as { id: string; value: unknown }[];
    for (const fixture of fixtures) {
      expect(() => validateProtocolDeploymentContractV3(fixture.value)).not.toThrow();
      // `not` and `or` segment predicates have no local segment form (decision 0005).
      if (fixture.id === 'segment-logical-predicate') {
        expect(() => rehydrateProtocolDeploymentContract(fixture.value)).toThrow(UnsupportedContractFeatureError);
      } else {
        expect(() => rehydrateProtocolDeploymentContract(fixture.value)).not.toThrow();
      }
    }
  });

  it('exports the same common deployment as Python authoring', () => {
    const fixture = JSON.parse(readFileSync(new URL('../../../specs/datasets/common-authoring-v1.json', import.meta.url), 'utf8'));
    const ds = dataset('orders', {
      source: 'analytics.orders', tenantKey: 'tenant_id', timeKey: 'createdAt',
      dimensions: { amount: dimension.number(), createdAt: dimension.timestamp(), status: dimension.string() },
      measures: { revenue: measure.sum('amount'), paidRevenue: measure.sum('amount', { filters: [eq('status', 'paid')] }) },
    });
    expect(buildProtocolDeploymentContract([ds])).toEqual(fixture);
  });
});
