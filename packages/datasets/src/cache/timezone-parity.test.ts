import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { scopedDefinitionIdentity } from './definition-identity.js';

it('matches Python timezone partitions for released definitions', () => {
  const cases = JSON.parse(readFileSync(new URL('../../../../specs/datasets/query-timezone-cache-v1.json', import.meta.url), 'utf8')) as { identity: string; timezone: string; partition: string }[];
  for (const row of cases) {
    expect(scopedDefinitionIdentity(row.identity, undefined, row.timezone === 'UTC' ? undefined : row.timezone)).toBe(row.partition);
  }
});
