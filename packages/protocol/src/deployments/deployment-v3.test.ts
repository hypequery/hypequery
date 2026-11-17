import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  PROTOCOL_DEPLOYMENT_V3_IDENTITY_DOMAIN,
  ProtocolDeploymentError,
  prepareProtocolDeploymentContract,
  prepareProtocolDeploymentContractAnyVersion,
  prepareProtocolDeploymentContractV3,
  validateProtocolDeploymentContract,
  validateProtocolDeploymentContractAnyVersion,
  validateProtocolDeploymentContractAtLowestVersion,
  validateProtocolDeploymentContractV3,
} from './index.js';
import { resolveProtocolVisibleDatasetFields, validateProtocolFieldVisibility } from '../visibility/index.js';

interface Case { id: string; value: Record<string, unknown>; error?: string }
interface IdentityCase { id: string; canonical: string; sha256: string }

function fixture<T>(family: string, name: string): T {
  const path = fileURLToPath(new URL(
    `../../../../specs/security-protocol/fixtures/${family}/${name}`,
    import.meta.url,
  ));
  return JSON.parse(readFileSync(path, 'utf8')) as T;
}

function code(run: () => unknown): string | undefined {
  try {
    run();
    return undefined;
  } catch (error) {
    if (error instanceof ProtocolDeploymentError) return error.code;
    throw error;
  }
}

const success = fixture<Case[]>('deployments-v3', 'success.json');
const rejections = fixture<Case[]>('deployments-v3', 'rejections.json');
const identities = fixture<IdentityCase[]>('deployments-v3', 'identity.json');
const v2Success = fixture<Case[]>('deployments-v2', 'success.json');

describe('deployment contract 3', () => {
  it('accepts the success fixtures and reproduces their identities', () => {
    expect(PROTOCOL_DEPLOYMENT_V3_IDENTITY_DOMAIN).toBe('hypequery:deployment:v3\0');
    for (const entry of success) {
      const prepared = prepareProtocolDeploymentContractV3(entry.value);
      const expected = identities.find(item => item.id === entry.id);
      expect(expected, entry.id).toBeDefined();
      expect({ canonical: prepared.canonical, sha256: prepared.identity }, entry.id)
        .toEqual({ canonical: expected!.canonical, sha256: expected!.sha256 });
    }
  });

  it('rejects the rejection fixtures with their stable codes', () => {
    for (const entry of rejections) {
      expect(code(() => validateProtocolDeploymentContractV3(entry.value)), entry.id).toBe(entry.error);
    }
  });

  it('leaves contract 2 validation unchanged', () => {
    for (const entry of v2Success) {
      expect(() => validateProtocolDeploymentContract(entry.value), entry.id).not.toThrow();
      expect(code(() => validateProtocolDeploymentContractV3(entry.value)), entry.id)
        .toBe('HQ_DEPLOYMENT_INVALID_VERSION');
    }
    const [segments] = success;
    expect(code(() => validateProtocolDeploymentContract({ ...segments!.value, version: 2 })))
      .toBe('HQ_DEPLOYMENT_UNKNOWN_FIELD');
  });

  it('returns frozen segments with the marker only where it applies', () => {
    const approximate = success.find(entry => entry.id === 'approximate-derived-measure')!;
    const contract = validateProtocolDeploymentContractV3(approximate.value);
    const [dataset] = contract.datasets;
    expect(dataset!.measures.map(measure => [measure.name, measure.approximate ?? false]))
      .toEqual([['activeUsers', true], ['sessions', false], ['sessionsPerUser', true]]);
    expect(Object.isFrozen(dataset!.segments)).toBe(true);
    expect('filters' in dataset!).toBe(false);
  });

  it('keeps window and shift measures in authored order beside the measures they wrap', () => {
    const timed = success.find(entry => entry.id === 'window-and-shift-measures')!;
    const [dataset] = validateProtocolDeploymentContractV3(timed.value).datasets;
    expect(dataset!.measures.map(measure => ('kind' in measure ? measure.kind : 'base')))
      .toEqual(['base', 'window', 'window', 'window', 'shift', 'derived']);
    expect(dataset!.measures[1]).toMatchObject({
      trailing: { amount: 7, unit: 'day' }, requiresTimeRange: true,
    });
    expect(dataset!.measures.filter(measure => 'kind' in measure
      && (measure.kind === 'window' || measure.kind === 'shift'))
      .every(measure => 'requiresTimeRange' in measure && measure.requiresTimeRange === true)).toBe(true);
    expect(code(() => validateProtocolDeploymentContract({
      ...timed.value,
      version: 2,
    }))).toBe('HQ_DEPLOYMENT_UNKNOWN_FIELD');
  });

  it('accepts a contract 3 dataset with no segments field', () => {
    const withoutSegments = success.find(entry => entry.id === 'approx-count-distinct-without-segments')!;
    const [dataset] = validateProtocolDeploymentContractV3(withoutSegments.value).datasets;
    expect('segments' in dataset!).toBe(false);
    expect(dataset!.measures[0]).toMatchObject({ aggregation: 'approxCountDistinct', approximate: true });
  });
});

describe('reading contract 2 and 3 together', () => {
  it('dispatches on version and keeps each version\'s identity domain', () => {
    const [v2] = v2Success;
    const [v3] = success;
    expect(validateProtocolDeploymentContractAnyVersion(v2!.value).version).toBe(2);
    expect(validateProtocolDeploymentContractAnyVersion(v3!.value).version).toBe(3);
    expect(prepareProtocolDeploymentContractAnyVersion(v2!.value).identity)
      .toBe(prepareProtocolDeploymentContract(v2!.value).identity);
    expect(prepareProtocolDeploymentContractAnyVersion(v3!.value).identity)
      .toBe(prepareProtocolDeploymentContractV3(v3!.value).identity);
    // Anything that is not `version: 3` is read, and rejected, as contract 2.
    expect(code(() => validateProtocolDeploymentContractAnyVersion({ ...v2!.value, version: 4 })))
      .toBe('HQ_DEPLOYMENT_INVALID_VERSION');
  });

  it('lowers a contract 3 that no longer uses a contract 3 feature to contract 2', () => {
    const approximate = success.find(entry => entry.id === 'approx-count-distinct-without-segments')!;
    const kept = validateProtocolDeploymentContractAtLowestVersion(approximate.value);
    expect(kept.version).toBe(3);

    const datasets = (approximate.value.datasets as Record<string, unknown>[]).map(dataset => ({
      ...dataset,
      measures: (dataset.measures as Record<string, unknown>[])
        .map(measure => ({ ...measure, aggregation: 'countDistinct', approximate: undefined }))
        .map(({ approximate: _approximate, ...measure }) => measure),
      segments: [],
    }));
    const lowered = validateProtocolDeploymentContractAtLowestVersion({ ...approximate.value, datasets });
    expect(lowered.version).toBe(2);
    const dataset = lowered.datasets[0] as unknown as Record<string, unknown>;
    expect('allowedFilters' in dataset).toBe(false);
    expect('segments' in dataset).toBe(false);
    expect(dataset.filters).toEqual(datasets[0]!.allowedFilters);
    // Contract 2 input passes through unchanged.
    expect(validateProtocolDeploymentContractAtLowestVersion(v2Success[0]!.value))
      .toEqual(validateProtocolDeploymentContract(v2Success[0]!.value));
  });

  it('hides a segment whose predicate reads a hidden dimension', () => {
    const segments = success.find(entry => entry.id === 'segments')!;
    const contract = validateProtocolDeploymentContractV3(segments.value);
    const dataset = contract.datasets[0]!;
    const byName = new Map(contract.datasets.map(item => [String(item.name), item]));
    const policy = (dimensions: string[] | '*') => validateProtocolFieldVisibility({
      kind: 'hypequery-field-visibility', version: 1,
      datasets: { [String(dataset.name)]: { dimensions, measures: '*' } },
    });
    expect([...resolveProtocolVisibleDatasetFields(dataset, byName, policy('*'))!.segments!]).toEqual(['enterprise']);
    const withoutTier = dataset.dimensions.map(item => String(item.name)).filter(name => name !== 'tier');
    expect([...resolveProtocolVisibleDatasetFields(dataset, byName, policy(withoutTier))!.segments!]).toEqual([]);
    // The renamed allow-list is read like contract 2's.
    expect([...resolveProtocolVisibleDatasetFields(dataset, byName, policy('*'))!.filters]).toEqual(['status']);
  });
});
