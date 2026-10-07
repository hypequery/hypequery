import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { dataset, dimension, getDatasetCatalog } from './index.js';
import type { TimeGrain } from './types.js';

it('matches Python catalogs for explicitly allowed grains', () => {
  const cases = JSON.parse(readFileSync(new URL('../../../specs/datasets/time-grains-v1.json', import.meta.url), 'utf8')) as { allowed: TimeGrain[] }[];
  for (const row of cases) {
    const ds = dataset('events', { source: 'events', timeKey: 'at', timeGrains: row.allowed, dimensions: { at: dimension.timestamp() } });
    expect(getDatasetCatalog(ds).supportedGrains).toEqual(row.allowed);
  }
});
