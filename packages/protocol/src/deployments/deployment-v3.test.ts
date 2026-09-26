import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  PROTOCOL_DEPLOYMENT_V3_IDENTITY_DOMAIN,
  ProtocolDeploymentError,
  prepareProtocolDeploymentContractV3,
  validateProtocolDeploymentContract,
  validateProtocolDeploymentContractV3,
} from './index.js';

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
    expect(dataset!.measures[1]).toMatchObject({ trailing: { amount: 7, unit: 'day' } });
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
