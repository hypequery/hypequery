import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseProtocolIdentifier, validateProtocolDeploymentContractV3 } from '@hypequery/protocol';
import capabilitySource from './execution-capabilities.json' with { type: 'json' };
import { add, between, buildProtocolDeploymentContract, createDatasetClient, createPortableSemanticRuntime, DATASET_EXECUTION_CAPABILITIES, dataset, dimension, eq, measure, publishToCloud, rehydrateProtocolDeploymentContract } from './index.js';
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
    ...(feature === 'subDayGrains' ? { timeGrains: ['minute', 'hour'] as const } : {}),
  });
}

describe('dataset execution capability matrix', () => {
  const features = DATASET_EXECUTION_CAPABILITIES.features;
  it('covers every declared feature exactly once and freezes discovery data', () => {
    expect(DATASET_EXECUTION_CAPABILITIES).toEqual(capabilitySource);
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
    if (!entry.typescript.publish) {
      expect(publish).toThrow();
      expect(entry.cloud).toBe(false);
    } else {
      const deployment = publish();
      expect(deployment.version).toBe(DATASET_EXECUTION_CAPABILITIES.cloudDeploymentVersion);
      const runtime = createPortableSemanticRuntime({ queryBuilder: factory });
      const input = {
        deployment, dataset: deployment.datasets[0]!, tenant: undefined,
        operation: { kind: 'dataset' as const, dataset: deployment.datasets[0]!.name, measures: query.measures?.map(parseProtocolIdentifier) },
        activationRevision: 'a'.repeat(64), budget: { maxRows: 100 },
      };
      const compiled = runtime.compile(input);
      expect(compiled.describe().measures).toEqual(query.measures);
      expect((await runtime.execute(input)).activationRevision).toBe(input.activationRevision);
      expect(entry.cloud).toBe(true);
    }
  });

  it('does not advertise v3 protocol acceptance as executable Cloud support', () => {
    const fixtures = JSON.parse(readFileSync(new URL('../../../specs/security-protocol/fixtures/deployments-v3/success.json', import.meta.url), 'utf8')) as { value: unknown }[];
    for (const fixture of fixtures) {
      expect(() => validateProtocolDeploymentContractV3(fixture.value)).not.toThrow();
      expect(() => rehydrateProtocolDeploymentContract(fixture.value)).toThrow();
    }
    for (const entry of features.filter(entry => entry.protocolVersions.includes(3) && !entry.protocolVersions.includes(2))) expect(entry.cloud).toBe(false);
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
