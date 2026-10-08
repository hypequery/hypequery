import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { buildProtocolDeploymentContract, createDatasetClient, dataset, dimension, getDatasetCatalog, measure, serializeSemanticContract } from './index.js';
import type { TimeGrain } from './types.js';

interface GrainCase { allowed: TimeGrain[]; accepted: TimeGrain[]; rejected: TimeGrain[]; contract: string[]; publishable: boolean }

it('matches Python for explicitly allowed grains', () => {
  const cases = JSON.parse(readFileSync(new URL('../../../specs/datasets/time-grains-v1.json', import.meta.url), 'utf8')) as GrainCase[];
  const client = createDatasetClient({ queryBuilder: { table: () => { throw new Error('not executed'); } } as never });
  for (const row of cases) {
    const ds = dataset('events', { source: 'events', timeKey: 'at', timeGrains: row.allowed, dimensions: { at: dimension.timestamp() }, measures: { rows: measure.count('at') } });
    expect(getDatasetCatalog(ds).supportedGrains).toEqual(row.allowed);
    expect(serializeSemanticContract({ events: ds }).datasets.events.supportedGrains).toEqual(row.contract);
    for (const grain of row.accepted) expect(client.validate(ds, { measures: ['rows'], by: grain }).valid).toBe(true);
    for (const grain of row.rejected) {
      expect(client.validate(ds, { measures: ['rows'], by: grain }).errors)
        .toContain(`Unsupported time grain "${grain}". Supported: ${row.allowed.join(', ')}`);
    }
    if (row.publishable) expect(() => buildProtocolDeploymentContract([ds])).not.toThrow();
    else expect(() => buildProtocolDeploymentContract([ds])).toThrow(/cannot preserve dataset-level grain restrictions/);
  }
});
