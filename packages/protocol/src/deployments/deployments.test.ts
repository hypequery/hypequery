import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  ProtocolDeploymentError,
  validateProtocolDeploymentContract,
} from './index.js';

interface SuccessFixture { id: string; value: unknown }
interface RejectionFixture {
  id: string;
  generator: { type: string };
  error: string;
}

const FAILURE_CODES = [
  'HQ_DEPLOYMENT_TYPE',
  'HQ_DEPLOYMENT_UNKNOWN_FIELD',
  'HQ_DEPLOYMENT_INVALID_VERSION',
  'HQ_DEPLOYMENT_INVALID_IDENTIFIER',
  'HQ_DEPLOYMENT_INVALID_VALUE',
  'HQ_DEPLOYMENT_INVALID_REFERENCE',
  'HQ_DEPLOYMENT_TOO_MANY_ITEMS',
  'HQ_DEPLOYMENT_TOO_LARGE',
  'HQ_DEPLOYMENT_UNSAFE_OBJECT',
] as const;

function readFixture<T>(name: string): T {
  const path = fileURLToPath(new URL(
    `../../../../specs/security-protocol/fixtures/deployments-v1/${name}`,
    import.meta.url,
  ));
  return JSON.parse(readFileSync(path, 'utf8')) as T;
}

function minimalDataset(name = 'orders') {
  return {
    name,
    source: 'orders',
    tenant: { kind: 'not-required' },
    dimensions: [],
    measures: [],
    filters: [],
    metrics: [],
    relationships: [],
  };
}

function baseDeployment() {
  return {
    kind: 'hypequery-deployment',
    version: 1,
    datasets: [minimalDataset()],
    queries: [],
    artifacts: [],
  };
}

function materialize(type: string): unknown {
  const value = baseDeployment();
  switch (type) {
    case 'wrong-root-type':
      return [];
    case 'unknown-root-field':
      return { ...value, extra: true };
    case 'unsupported-version':
      return { ...value, version: 2 };
    case 'invalid-dataset-identifier':
      return { ...value, datasets: [minimalDataset('bad-name')] };
    case 'invalid-relationship-queryability':
      return {
        ...value,
        datasets: [{
          ...minimalDataset(),
          relationships: [{
            name: 'items', kind: 'hasMany', target: 'orders', from: 'id', to: 'order_id', queryable: true,
          }],
        }],
      };
    case 'missing-runtime-artifact':
      return {
        ...value,
        queries: [{
          name: 'health',
          input: { kind: 'any' },
          output: { kind: 'any' },
          implementation: {
            kind: 'runtime-reference',
            runtime: 'node',
            artifactSha256: '0'.repeat(64),
            entrypoint: 'queries.health',
          },
          endpoint: {
            access: { kind: 'public' },
            tenant: { kind: 'not-required' },
            method: 'GET',
            path: '/health',
          },
          tags: [],
        }],
      };
    case 'too-many-datasets':
      return {
        ...value,
        datasets: Array.from({ length: 101 }, (_, index) => minimalDataset(`dataset_${index}`)),
      };
    case 'source-too-large':
      return { ...value, datasets: [{ ...minimalDataset(), source: 'a'.repeat(1_025) }] };
    case 'unsafe-accessor': {
      const unsafe = baseDeployment() as Record<string, unknown>;
      Object.defineProperty(unsafe, 'kind', { enumerable: true, get: () => 'hypequery-deployment' });
      return unsafe;
    }
    default:
      throw new Error(`Unknown fixture generator: ${type}`);
  }
}

function expectDeploymentError(action: () => unknown, code: string): void {
  try {
    action();
    throw new Error('Expected deployment validation to fail');
  } catch (error) {
    expect(error).toBeInstanceOf(ProtocolDeploymentError);
    expect((error as ProtocolDeploymentError).code).toBe(code);
  }
}

describe('deployment contract v1', () => {
  const success = readFixture<SuccessFixture[]>('success.json');
  const rejections = readFixture<RejectionFixture[]>('rejections.json');

  it('has unique fixtures and covers every stable error code', () => {
    const fixtures = [...success, ...rejections];
    expect(new Set(fixtures.map(fixture => fixture.id)).size).toBe(fixtures.length);
    expect([...new Set(rejections.map(fixture => fixture.error))].sort())
      .toEqual([...FAILURE_CODES].sort());
  });

  it.each(success)('accepts $id as an immutable snapshot', ({ value }) => {
    const contract = validateProtocolDeploymentContract(value);
    expect(contract).toEqual(value);
    expect(Object.isFrozen(contract)).toBe(true);
    expect(Object.isFrozen(contract.datasets)).toBe(true);
    expect(Object.isFrozen(contract.queries[0]?.implementation)).toBe(true);
  });

  it.each(rejections)('rejects $id with its stable code', fixture => {
    expectDeploymentError(
      () => validateProtocolDeploymentContract(materialize(fixture.generator.type)),
      fixture.error,
    );
  });

  it('permits lower product limits but rejects raised limits', () => {
    const twoDatasets = {
      ...baseDeployment(),
      datasets: [minimalDataset('orders'), minimalDataset('customers')],
    };
    expectDeploymentError(
      () => validateProtocolDeploymentContract(twoDatasets, { limits: { maxDatasets: 1 } }),
      'HQ_DEPLOYMENT_TOO_MANY_ITEMS',
    );
    expect(() => validateProtocolDeploymentContract(baseDeployment(), { limits: { maxDatasets: 101 } }))
      .toThrow(RangeError);
  });

  it('validates compiled input bindings against the named-query input schema', () => {
    const deployment = {
      ...baseDeployment(),
      queries: [{
        name: 'lookup',
        input: {
          kind: 'object',
          properties: { id: { kind: 'string' } },
          required: ['id'],
          unknownProperties: 'reject',
        },
        output: { kind: 'any' },
        implementation: {
          kind: 'compiled-sql',
          dialect: 'clickhouse',
          operation: 'select',
          statement: 'SELECT * FROM orders WHERE id = {id:String}',
          parameters: [{
            name: 'id',
            source: { kind: 'input', path: 'missing' },
            clickHouseType: 'String',
          }],
          readSources: ['orders'],
          tenant: { kind: 'not-required' },
        },
        endpoint: {
          access: { kind: 'public' },
          tenant: { kind: 'not-required' },
          method: 'GET',
          path: '/lookup',
        },
        tags: [],
      }],
    };
    expectDeploymentError(
      () => validateProtocolDeploymentContract(deployment),
      'HQ_DEPLOYMENT_INVALID_REFERENCE',
    );
  });
});
