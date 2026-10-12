import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ProtocolQueryImplementationError } from '../query-implementations/index.js';
import {
  checkProtocolDatasetContract,
  checkProtocolDeploymentContract,
  checkProtocolDeploymentContractV3,
  validateProtocolDeploymentContract,
  validateProtocolDeploymentContractV3,
} from './index.js';
import type { ProtocolDeploymentCheckResult } from './index.js';

type Fixture = { id: string; value: unknown; error?: string };

function fixtures(name: string): Fixture[] {
  return JSON.parse(readFileSync(
    new URL(`../../../../specs/security-protocol/fixtures/${name}`, import.meta.url),
    'utf8',
  )) as Fixture[];
}

function sqlSource(sql: unknown) {
  return {
    kind: 'sql-expression', dialect: 'clickhouse', sql,
    output: { kind: 'string' }, dependencies: [],
  };
}

function dimension(name: string, source: unknown = { kind: 'column', column: name }) {
  return { name, type: 'string', source, filterable: true, groupable: true };
}

function dataset(name: string, overrides: Record<string, unknown> = {}) {
  return {
    name, source: name, tenant: { kind: 'not-required' },
    dimensions: [dimension('region')],
    measures: [{ name: 'revenue', aggregation: 'sum', field: 'amount', filters: [] }],
    filters: [], relationships: [],
    ...overrides,
  };
}

function relationship(target: string) {
  return { name: target, kind: 'belongsTo', target, from: 'region', to: 'region', queryable: true };
}

function deployment(datasets: unknown[]) {
  return { kind: 'hypequery-deployment', version: 2, datasets };
}

function failures<T>(result: ProtocolDeploymentCheckResult<T>) {
  if (result.ok) throw new Error('expected the check to fail');
  return result.errors.map(error => `${error.code} at ${error.path}`);
}

function thrown(action: () => unknown): unknown {
  try {
    action();
  } catch (error) {
    return error;
  }
  throw new Error('expected a throw');
}

describe('embedded SQL expression failures', () => {
  it('keep the RFC 0005 code but locate the failure in the contract', () => {
    const contract = deployment([dataset('orders', {
      dimensions: [dimension('region'), dimension('country', sqlSource('   '))],
    })]);
    const error = thrown(() => validateProtocolDeploymentContract(contract));
    expect(error).toBeInstanceOf(ProtocolQueryImplementationError);
    expect(error).toMatchObject({
      code: 'HQ_QUERY_IMPLEMENTATION_INVALID_VALUE',
      path: '$.datasets[0].dimensions[1].source.sql',
      message: 'HQ_QUERY_IMPLEMENTATION_INVALID_VALUE at $.datasets[0].dimensions[1].source.sql',
    });
  });

  it('locate a malformed measure SQL envelope', () => {
    const contract = deployment([dataset('orders', {
      measures: [{
        name: 'revenue', aggregation: 'sum', field: 'amount', filters: [],
        sql: { ...sqlSource('amount'), dialect: 'postgres' },
      }],
    })]);
    expect(thrown(() => validateProtocolDeploymentContract(contract))).toMatchObject({
      code: 'HQ_QUERY_IMPLEMENTATION_INVALID_VALUE',
      path: '$.datasets[0].measures[0].sql.dialect',
    });
  });
});

describe('checkProtocolDeploymentContract', () => {
  it('returns the validated contract when valid', () => {
    const contract = deployment([dataset('orders')]);
    const result = checkProtocolDeploymentContract(contract);
    expect(result).toEqual({ ok: true, value: validateProtocolDeploymentContract(contract) });
  });

  it('reports failures across fields, items and datasets in one pass', () => {
    const contract = {
      ...deployment([
        dataset('orders', {
          source: '',
          extra: true,
          dimensions: [dimension('region'), dimension('bad name'), dimension('country', sqlSource(42))],
        }),
        dataset('customers', {
          measures: [{ name: 'revenue', aggregation: 'median', field: 'amount', filters: [] }],
          owner: 7,
        }),
      ]),
      queries: [],
    };
    expect(failures(checkProtocolDeploymentContract(contract))).toEqual([
      'HQ_DEPLOYMENT_UNKNOWN_FIELD at $.queries',
      'HQ_DEPLOYMENT_UNKNOWN_FIELD at $.datasets[0].extra',
      'HQ_DEPLOYMENT_INVALID_VALUE at $.datasets[0].source',
      'HQ_DEPLOYMENT_INVALID_IDENTIFIER at $.datasets[0].dimensions[1].name',
      'HQ_QUERY_IMPLEMENTATION_TYPE at $.datasets[0].dimensions[2].source.sql',
      'HQ_DEPLOYMENT_INVALID_VALUE at $.datasets[1].measures[0].aggregation',
      'HQ_DEPLOYMENT_TYPE at $.datasets[1].owner',
    ]);
  });

  it('reports every dangling cross-dataset reference', () => {
    const contract = deployment([
      dataset('orders', { relationships: [relationship('missingA'), relationship('missingB')] }),
    ]);
    expect(failures(checkProtocolDeploymentContract(contract))).toEqual([
      'HQ_DEPLOYMENT_INVALID_REFERENCE at $.datasets[0].relationships[0].target',
      'HQ_DEPLOYMENT_INVALID_REFERENCE at $.datasets[0].relationships[1].target',
    ]);
  });

  it('skips cross-dataset checks while a dataset is invalid, so failures do not cascade', () => {
    const contract = deployment([
      dataset('orders', { relationships: [relationship('customers')] }),
      { ...dataset('customers'), name: 'bad name' },
    ]);
    expect(failures(checkProtocolDeploymentContract(contract)))
      .toEqual(['HQ_DEPLOYMENT_INVALID_IDENTIFIER at $.datasets[1].name']);
  });

  it('keeps checking sibling measures after a malformed one', () => {
    const contract = deployment([dataset('orders', {
      measures: [null, { name: 'revenue', aggregation: 'median', field: 'amount', filters: [] }],
    })]);
    expect(failures(checkProtocolDeploymentContract(contract))).toEqual([
      'HQ_DEPLOYMENT_TYPE at $.datasets[0].measures[0]',
      'HQ_DEPLOYMENT_INVALID_VALUE at $.datasets[0].measures[1].aggregation',
    ]);
  });

  it('reports every unresolved derived-measure input', () => {
    const derived = (name: string, input: string) => ({
      kind: 'derived', name,
      uses: [{ alias: 'a', measure: input }, { alias: 'b', measure: 'revenue' }],
      expression: {
        kind: 'binary', operator: 'divide',
        left: { kind: 'reference', name: 'a' }, right: { kind: 'reference', name: 'b' },
      },
    });
    const contract = deployment([dataset('orders', {
      measures: [
        { name: 'revenue', aggregation: 'sum', field: 'amount', filters: [] },
        derived('first', 'missingA'),
        derived('second', 'missingB'),
      ],
    })]);
    expect(failures(checkProtocolDeploymentContract(contract))).toEqual([
      'HQ_DEPLOYMENT_INVALID_REFERENCE at $.datasets[0].measures[1].uses[0].measure',
      'HQ_DEPLOYMENT_INVALID_REFERENCE at $.datasets[0].measures[2].uses[0].measure',
    ]);
  });

  it('reports every failing dataset metadata field', () => {
    const contract = deployment([dataset('orders', { format: 7, sensitivity: 'invalid' })]);
    expect(failures(checkProtocolDeploymentContract(contract))).toEqual([
      'HQ_DEPLOYMENT_TYPE at $.datasets[0].format',
      'HQ_DEPLOYMENT_INVALID_VALUE at $.datasets[0].sensitivity',
    ]);
  });

  it('stops at a wrong version, whose rules do not apply', () => {
    const contract = { ...deployment([dataset('orders', { source: '' })]), version: 9 };
    expect(failures(checkProtocolDeploymentContract(contract)))
      .toEqual(['HQ_DEPLOYMENT_INVALID_VERSION at $.version']);
  });

  it('bounds the report', () => {
    const contract = deployment(Array.from({ length: 60 }, (_, index) => dataset(`d${index}`, {
      source: '', owner: 7,
    })));
    const result = checkProtocolDeploymentContract(contract);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors).toHaveLength(100);
    expect(result.truncated).toBe(true);
  });

  it('still throws for invalid options rather than reporting them as contract failures', () => {
    expect(() => checkProtocolDeploymentContract(deployment([]), { limits: { maxDatasets: 0 } }))
      .toThrow(RangeError);
  });

  it.each([
    ['deployments-v2', checkProtocolDeploymentContract, validateProtocolDeploymentContract],
    ['deployments-v3', checkProtocolDeploymentContractV3, validateProtocolDeploymentContractV3],
  ] as const)('agrees with the throwing validator on every %s fixture', (family, check, validate) => {
    for (const entry of fixtures(`${family}/success.json`)) {
      expect(check(entry.value), entry.id).toEqual({ ok: true, value: validate(entry.value) });
    }
    for (const entry of fixtures(`${family}/rejections.json`)) {
      const first = thrown(() => validate(entry.value)) as { code: string; path: string };
      const result = check(entry.value);
      expect(result.ok, entry.id).toBe(false);
      if (result.ok) continue;
      // The first failure the validator throws is always among those reported.
      expect(result.errors.map(error => `${error.code} at ${error.path}`), entry.id)
        .toContain(`${first.code} at ${first.path}`);
    }
  });
});

describe('checkProtocolDatasetContract', () => {
  it('reports every failing field of one dataset', () => {
    expect(failures(checkProtocolDatasetContract({ ...dataset('orders', { source: '' }), metrics: [], owner: 1 })))
      .toEqual([
        'HQ_DEPLOYMENT_INVALID_VALUE at $.source',
        'HQ_DEPLOYMENT_TYPE at $.owner',
      ]);
  });
});
