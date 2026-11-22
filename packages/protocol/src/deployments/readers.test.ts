import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  datasetAllowedFilters,
  datasetContract3Features,
  datasetGrains,
  datasetSegments,
  datasetTimeAxes,
  validateProtocolDeploymentContract,
  validateProtocolDeploymentContractV3,
  withDatasetAllowedFilters,
} from './index.js';
import type { ProtocolDatasetContract, ProtocolDeploymentDataset, ProtocolDeploymentDatasetV3 } from './index.js';

const FIXTURES = new URL('../../../../specs/security-protocol/fixtures/', import.meta.url);
const success = (family: string) => JSON.parse(readFileSync(new URL(`${family}/success.json`, FIXTURES), 'utf8')) as { id: string; value: unknown }[];
const fixture = (family: string, id: string) => success(family).find(entry => entry.id === id)!.value;

const v2 = validateProtocolDeploymentContract(fixture('deployments-v2', 'derived-measures')).datasets[0]!;
const segmented = validateProtocolDeploymentContractV3(fixture('deployments-v3', 'segments')).datasets[0]!;
const alternates = validateProtocolDeploymentContractV3(fixture('deployments-v3', 'alternate-time-fields')).datasets[0]!;

const FILTER = { name: 'region', field: 'region', operators: ['eq'] } as const;

describe('version-neutral contract readers (RFC 0030)', () => {
  it('reads the filter allow-list under either name', () => {
    expect(datasetAllowedFilters(v2)).toBe((v2 as ProtocolDeploymentDataset).filters);
    expect(datasetAllowedFilters(segmented)).toBe((segmented as ProtocolDeploymentDatasetV3).allowedFilters);
    expect(datasetAllowedFilters(segmented).length).toBeGreaterThan(0);
    // An RFC 0006 dataset contract also calls it `filters`.
    const record = { ...v2, filters: [FILTER], metrics: [] } as unknown as ProtocolDatasetContract;
    expect(datasetAllowedFilters(record)).toEqual([FILTER]);
    expect(datasetAllowedFilters({ ...v2, filters: undefined } as never)).toEqual([]);
  });

  it('writes the allow-list back under the dataset\'s own version\'s name', () => {
    const narrowedV2 = withDatasetAllowedFilters(v2, [FILTER]);
    expect(narrowedV2).toMatchObject({ filters: [FILTER] });
    expect('allowedFilters' in narrowedV2).toBe(false);
    const narrowedV3 = withDatasetAllowedFilters(segmented, []);
    expect(narrowedV3).toMatchObject({ allowedFilters: [] });
    expect('filters' in narrowedV3).toBe(false);
    expect(datasetAllowedFilters(narrowedV3)).toEqual([]);
    // The input is not modified.
    expect(datasetAllowedFilters(segmented).length).toBeGreaterThan(0);
  });

  it('reads segments, none on contract 2', () => {
    expect(datasetSegments(v2)).toEqual([]);
    expect(datasetSegments(segmented).map(segment => segment.name)).toEqual(
      (segmented as ProtocolDeploymentDatasetV3).segments!.map(segment => segment.name),
    );
  });

  it('reads the time axes: the default first, then alternates in authored order', () => {
    expect(datasetTimeAxes(alternates)).toEqual([alternates.timeField, ...(alternates as ProtocolDeploymentDatasetV3).alternateTimeFields!]);
    expect(datasetTimeAxes({ ...v2, timeField: 'created_at' } as never)).toEqual(['created_at']);
    expect(datasetTimeAxes({ ...v2, timeField: undefined } as never)).toEqual([]);
  });

  it('reads the queryable grains, which the contract version does not narrow', () => {
    const all = ['minute', 'hour', 'day', 'week', 'month', 'quarter', 'year'];
    expect(datasetGrains({ ...v2, timeField: 'created_at' } as never)).toEqual(all);
    expect(datasetGrains(alternates)).toEqual(all);
    expect(datasetGrains({ ...v2, timeField: undefined } as never)).toEqual([]);
  });

  it('names the contract 3 features of a dataset, none for contract 2', () => {
    expect(datasetContract3Features(v2)).toEqual([]);
    expect(datasetContract3Features(segmented)).toEqual(['segments']);
    expect(datasetContract3Features(alternates)).toEqual(['alternateTimeFields']);
  });
});
