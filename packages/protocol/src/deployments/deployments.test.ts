import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  encodeProtocolDeploymentContract,
  encodeProtocolDeploymentContractToString,
  hashProtocolDeploymentContract,
  prepareProtocolDeploymentContract,
  PROTOCOL_DEPLOYMENT_IDENTITY_DOMAIN,
  ProtocolDeploymentError,
  validateProtocolDatasetContract,
  validateProtocolDeploymentContract,
} from './index.js';

interface SuccessFixture { id: string; value: unknown }
interface RejectionFixture {
  id: string;
  generator: { type: string };
  error: string;
}
interface IdentityFixture {
  id: string;
  canonical: string;
  sha256: string;
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

function minimalMetric(overrides: Record<string, unknown> = {}) {
  return {
    name: 'revenue',
    kind: 'grained-metric',
    expression: { kind: 'literal', value: 1 },
    dimensions: [],
    filters: [],
    grains: ['day'],
    grain: 'day',
    endpoint: {
      access: { kind: 'public' },
      tenant: { kind: 'not-required' },
    },
    ...overrides,
  };
}

/** `revenue / nullIfZero(orders)`, carried in both the inlined and authored forms. */
function derivedMetric(overrides: Record<string, unknown> = {}) {
  const revenue = { kind: 'aggregate', aggregation: 'sum', field: 'amount' };
  const orders = { kind: 'aggregate', aggregation: 'count', field: 'id' };
  const guard = (operand: unknown) => ({ kind: 'call', function: 'nullIfZero', args: [operand] });
  return {
    ...minimalMetric({
      kind: 'derived-metric',
      grains: [],
      grain: undefined,
      expression: {
        kind: 'binary', operator: 'divide', left: revenue, right: guard(orders),
      },
      derivation: {
        inputs: [
          { alias: 'revenue', expression: revenue },
          { alias: 'orders', expression: orders },
        ],
        expression: {
          kind: 'binary', operator: 'divide',
          left: { kind: 'reference', name: 'revenue' },
          right: guard({ kind: 'reference', name: 'orders' }),
        },
      },
    }),
    ...overrides,
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
    case 'ambiguous-query-route': {
      const namedQuery = (name: string) => ({
        name,
        input: { kind: 'void' },
        output: { kind: 'void' },
        implementation: {
          kind: 'semantic-plan',
          query: {
            kind: 'dataset', dataset: 'orders', dimensions: [], measures: [], filters: [], orderBy: [],
          },
        },
        endpoint: {
          access: { kind: 'public' },
          tenant: { kind: 'not-required' },
          method: 'GET',
          path: '/same',
        },
        tags: [],
      });
      return { ...value, queries: [namedQuery('first'), namedQuery('second')] };
    }
    case 'invalid-sensitivity':
      return { ...value, datasets: [{ ...minimalDataset(), sensitivity: 'secret' }] };
    case 'invalid-currency':
      return { ...value, datasets: [{ ...minimalDataset(), currency: 'usd' }] };
    case 'empty-defaults':
      return { ...value, datasets: [{ ...minimalDataset(), defaults: {} }] };
    case 'default-dimension-not-groupable':
      return {
        ...value,
        datasets: [{
          ...minimalDataset(),
          dimensions: [{
            name: 'status',
            type: 'string',
            source: { kind: 'column', column: 'status' },
            filterable: true,
            groupable: false,
          }],
          defaults: { dimensions: ['status'] },
        }],
      };
    case 'default-grain-without-time-field':
      // `timeGrain` has nothing to apply to unless the dataset declares
      // `timeField`, so this is reported as a broken reference.
      return { ...value, datasets: [{ ...minimalDataset(), defaults: { timeGrain: 'day' } }] };
    case 'too-many-datasets':
      return {
        ...value,
        datasets: Array.from({ length: 101 }, (_, index) => minimalDataset(`dataset_${index}`)),
      };
    case 'too-many-synonyms':
      return {
        ...value,
        datasets: [{
          ...minimalDataset(),
          synonyms: Array.from({ length: 101 }, (_, index) => `synonym_${index}`),
        }],
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

function expectDeploymentError(action: () => unknown, code: string, path?: string): void {
  try {
    action();
    throw new Error('Expected deployment validation to fail');
  } catch (error) {
    expect(error).toBeInstanceOf(ProtocolDeploymentError);
    expect((error as ProtocolDeploymentError).code).toBe(code);
    if (path !== undefined) expect((error as ProtocolDeploymentError).path).toBe(path);
  }
}

describe('deployment contract v1', () => {
  const success = readFixture<SuccessFixture[]>('success.json');
  const rejections = readFixture<RejectionFixture[]>('rejections.json');
  const identities = readFixture<IdentityFixture[]>('identity.json');

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

  it.each(identities)('$id matches canonical deployment bytes and identity', fixture => {
    const value = success.find(candidate => candidate.id === fixture.id)?.value;
    expect(value).toBeDefined();
    const prepared = prepareProtocolDeploymentContract(value);
    expect(prepared.contract).toEqual(value);
    expect(prepared.canonical).toBe(fixture.canonical);
    expect(new TextDecoder().decode(prepared.bytes)).toBe(fixture.canonical);
    expect(prepared.identity).toBe(fixture.sha256);
    expect(Object.isFrozen(prepared)).toBe(true);
  });

  it('produces canonical bytes and a domain-separated deployment identity', () => {
    const deployment = baseDeployment();
    const reordered = {
      artifacts: deployment.artifacts,
      queries: deployment.queries,
      datasets: deployment.datasets,
      version: deployment.version,
      kind: deployment.kind,
    };
    const canonical = encodeProtocolDeploymentContractToString(deployment);

    expect(new TextDecoder().decode(encodeProtocolDeploymentContract(deployment))).toBe(canonical);
    expect(encodeProtocolDeploymentContractToString(reordered)).toBe(canonical);
    expect(hashProtocolDeploymentContract(reordered)).toBe(hashProtocolDeploymentContract(deployment));
    expect(hashProtocolDeploymentContract(deployment)).toBe(
      createHash('sha256')
        .update(PROTOCOL_DEPLOYMENT_IDENTITY_DOMAIN)
        .update(canonical)
        .digest('hex'),
    );
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
      .toThrow('maxDatasets must be a positive safe integer no greater than 100 '
        + '(the deployment contract v1 maximum)');
  });

  it('validates bounded agent metadata and immutable defaults', () => {
    const value = {
      ...minimalDataset(),
      description: 'Governed orders.',
      examples: ['Revenue by region'],
      synonyms: ['purchases'],
      format: 'table',
      unit: 'orders',
      currency: 'USD',
      timezone: 'UTC',
      sensitivity: 'internal',
      freshness: { maxAgeSeconds: 300 },
      owner: 'analytics@example.com',
      timeField: 'createdAt',
      dimensions: [{
        name: 'createdAt',
        type: 'timestamp',
        source: { kind: 'column', column: 'created_at' },
        filterable: true,
        groupable: true,
        synonyms: ['created'],
      }],
      defaults: { dimensions: ['createdAt'], timeGrain: 'day' },
    };

    const contract = validateProtocolDatasetContract(value);
    expect(contract).toMatchObject(value);
    expect(Object.isFrozen(contract.examples)).toBe(true);
    expect(Object.isFrozen(contract.defaults)).toBe(true);
    expect(Object.isFrozen(contract.defaults?.dimensions)).toBe(true);
  });

  it('rejects oversized, duplicate, and invalid agent metadata', () => {
    expectDeploymentError(
      () => validateProtocolDatasetContract(
        { ...minimalDataset(), description: '123456' },
        { limits: { maxTextBytes: 5 } },
      ),
      'HQ_DEPLOYMENT_TOO_LARGE',
      '$.description',
    );
    expectDeploymentError(
      () => validateProtocolDatasetContract({
        ...minimalDataset(),
        synonyms: ['orders', 'orders'],
      }),
      'HQ_DEPLOYMENT_INVALID_VALUE',
      '$.synonyms',
    );
    expectDeploymentError(
      () => validateProtocolDatasetContract({ ...minimalDataset(), currency: 'usd' }),
      'HQ_DEPLOYMENT_INVALID_VALUE',
      '$.currency',
    );
    expectDeploymentError(
      () => validateProtocolDeploymentContract({
        ...baseDeployment(),
        datasets: [{ ...minimalDataset(), defaults: { dimensions: ['missing'] } }],
      }),
      'HQ_DEPLOYMENT_INVALID_REFERENCE',
      '$.datasets[0].defaults.dimensions',
    );
  });

  it('requires endpoint and dataset tenancy to agree in both directions', () => {
    const TENANTED = {
      access: { kind: 'public' },
      tenant: { kind: 'required', mode: 'auto-inject', column: 'tenant_id' },
    };

    // An endpoint requiring a tenant over a dataset that declares no field to
    // scope by resolves one and then has nothing to filter on, so the query
    // reads every tenant while the endpoint reports tenancy as enforced.
    expectDeploymentError(
      () => validateProtocolDeploymentContract({
        ...baseDeployment(),
        datasets: [{ ...minimalDataset(), endpoint: TENANTED }],
      }),
      'HQ_DEPLOYMENT_INVALID_REFERENCE',
      '$.datasets[0].endpoint.tenant',
    );

    expectDeploymentError(
      () => validateProtocolDeploymentContract({
        ...baseDeployment(),
        datasets: [{
          ...minimalDataset(),
          metrics: [minimalMetric({ kind: 'metric', grains: [], grain: undefined, endpoint: TENANTED })],
        }],
      }),
      'HQ_DEPLOYMENT_INVALID_REFERENCE',
      '$.datasets[0].metrics[0].endpoint.tenant',
    );

    // The direction that already held: a tenant-scoped dataset cannot be
    // published through an endpoint that does not require one.
    expectDeploymentError(
      () => validateProtocolDeploymentContract({
        ...baseDeployment(),
        datasets: [{
          ...minimalDataset(),
          tenant: { kind: 'required', field: 'tenant_id' },
          endpoint: { access: { kind: 'public' }, tenant: { kind: 'not-required' } },
        }],
      }),
      'HQ_DEPLOYMENT_INVALID_REFERENCE',
      '$.datasets[0].endpoint.tenant',
    );
  });

  it('accepts a derived metric that carries its authored formula', () => {
    const contract = validateProtocolDeploymentContract({
      ...baseDeployment(),
      datasets: [{ ...minimalDataset(), metrics: [derivedMetric()] }],
    });

    const [metric] = contract.datasets[0].metrics;
    expect(metric.derivation?.inputs.map(input => input.alias)).toEqual(['revenue', 'orders']);
    // Input order is preserved rather than sorted: each becomes a column of the
    // intermediate aggregate in this order, so reordering changes the SQL.
    expect(metric.derivation?.expression).toMatchObject({ kind: 'binary', operator: 'divide' });
  });

  it('rejects a derivation that does not reproduce the metric expression', () => {
    // The two forms must describe one formula. Here the authored form divides
    // by the wrong input, so substituting the aliases back yields a different
    // expression than the metric advertises.
    const metric = derivedMetric();
    expectDeploymentError(
      () => validateProtocolDeploymentContract({
        ...baseDeployment(),
        datasets: [{
          ...minimalDataset(),
          metrics: [{
            ...metric,
            derivation: {
              ...metric.derivation,
              expression: {
                kind: 'binary', operator: 'divide',
                left: { kind: 'reference', name: 'orders' },
                right: { kind: 'reference', name: 'revenue' },
              },
            },
          }],
        }],
      }),
      'HQ_DEPLOYMENT_INVALID_REFERENCE',
      '$.datasets[0].metrics[0].derivation.expression',
    );
  });

  it('rejects a malformed or misplaced derivation', () => {
    const metric = derivedMetric();
    const withDerivation = (overrides: Record<string, unknown>) => () =>
      validateProtocolDeploymentContract({
        ...baseDeployment(),
        datasets: [{ ...minimalDataset(), metrics: [{ ...metric, ...overrides }] }],
      });

    // A metric whose expression is a bare aggregate has no formula, whatever
    // its kind says. `kind` cannot decide this: a base metric pinned to a grain
    // and a derived metric pinned to one both report `grained-metric`. The
    // one-input derivation here substitutes back to the aggregate, so only the
    // eligibility check stands between it and a contract nothing can rebuild.
    const aggregate = { kind: 'aggregate', aggregation: 'sum', field: 'amount' };
    expectDeploymentError(
      withDerivation({
        kind: 'grained-metric', grains: ['day'], grain: 'day', expression: aggregate,
        derivation: {
          inputs: [{ alias: 'revenue', expression: aggregate }],
          expression: { kind: 'reference', name: 'revenue' },
        },
      }),
      'HQ_DEPLOYMENT_INVALID_VALUE',
      '$.datasets[0].metrics[0].derivation',
    );
    expectDeploymentError(
      withDerivation({ derivation: { ...metric.derivation, inputs: [] } }),
      'HQ_DEPLOYMENT_INVALID_VALUE',
      '$.datasets[0].metrics[0].derivation.inputs',
    );
    // Two inputs under one alias: the second would silently shadow the first.
    expectDeploymentError(
      withDerivation({
        derivation: {
          ...metric.derivation,
          inputs: metric.derivation.inputs.map(input => ({ ...input, alias: 'revenue' })),
        },
      }),
      'HQ_DEPLOYMENT_INVALID_VALUE',
      '$.datasets[0].metrics[0].derivation.inputs[1].alias',
    );
    // Only an aggregate can become a column of the intermediate result.
    expectDeploymentError(
      withDerivation({
        derivation: {
          ...metric.derivation,
          inputs: [
            { alias: 'revenue', expression: { kind: 'literal', value: 1 } },
            metric.derivation.inputs[1],
          ],
        },
      }),
      'HQ_DEPLOYMENT_INVALID_VALUE',
      '$.datasets[0].metrics[0].derivation.inputs[0].expression',
    );
  });

  it('holds a derivation to the grammar a formula can be rebuilt from', () => {
    // RFC 0003 is wider than anything a formula can be written in. A derivation
    // exists to be rebuilt, so a form nothing can rebuild must not validate
    // here and fail later at the point of use.
    const metric = derivedMetric();
    const revenue = metric.derivation.inputs[0].expression;
    const orders = metric.derivation.inputs[1].expression;
    const withFormula = (expression: unknown, inlined: unknown) => () =>
      validateProtocolDeploymentContract({
        ...baseDeployment(),
        datasets: [{
          ...minimalDataset(),
          metrics: [{
            ...metric,
            expression: inlined,
            derivation: { inputs: metric.derivation.inputs, expression },
          }],
        }],
      });
    const ref = (name: string) => ({ kind: 'reference', name });
    const call = (fn: string, args: unknown[]) => ({ kind: 'call', function: fn, args });

    // `round` validates at one or two arguments as a protocol expression, but
    // the authoring helper always emits a precision, so a one-argument form has
    // no counterpart to rebuild it from.
    expectDeploymentError(
      withFormula(call('round', [ref('revenue')]), call('round', [revenue])),
      'HQ_DEPLOYMENT_INVALID_VALUE',
      '$.datasets[0].metrics[0].derivation.expression.args',
    );
    // A comparison is a valid expression and not a formula.
    expectDeploymentError(
      withFormula(
        { kind: 'comparison', operator: 'gt', left: ref('revenue'), right: ref('orders') },
        { kind: 'comparison', operator: 'gt', left: revenue, right: orders },
      ),
      'HQ_DEPLOYMENT_INVALID_VALUE',
      '$.datasets[0].metrics[0].derivation.expression',
    );
    // A literal is only expressible as a `round` precision or `coalesce`
    // fallback, never as an operand of arithmetic.
    expectDeploymentError(
      withFormula(
        { kind: 'binary', operator: 'divide', left: ref('revenue'), right: { kind: 'literal', value: 2 } },
        { kind: 'binary', operator: 'divide', left: revenue, right: { kind: 'literal', value: 2 } },
      ),
      'HQ_DEPLOYMENT_INVALID_VALUE',
      '$.datasets[0].metrics[0].derivation.expression.right',
    );
    // Both positions that do accept one stay accepted.
    expect(withFormula(
      call('round', [ref('revenue'), { kind: 'literal', value: 2 }]),
      call('round', [revenue, { kind: 'literal', value: 2 }]),
    )()).toBeDefined();
    expect(withFormula(
      call('coalesce', [ref('revenue'), { kind: 'literal', value: 0 }]),
      call('coalesce', [revenue, { kind: 'literal', value: 0 }]),
    )()).toBeDefined();
  });

  it('requires a grained metric fixed grain to be supported by the metric', () => {
    const deployment = {
      ...baseDeployment(),
      datasets: [{
        ...minimalDataset(),
        timeField: 'created_at',
        metrics: [minimalMetric({ grain: 'month', grains: ['day'] })],
      }],
    };

    expectDeploymentError(
      () => validateProtocolDeploymentContract(deployment),
      'HQ_DEPLOYMENT_INVALID_VALUE',
      '$.datasets[0].metrics[0].grain',
    );
  });

  it('rejects grained metrics with no supported grains', () => {
    const deployment = {
      ...baseDeployment(),
      datasets: [{
        ...minimalDataset(),
        metrics: [minimalMetric({ grains: [] })],
      }],
    };

    expectDeploymentError(
      () => validateProtocolDeploymentContract(deployment),
      'HQ_DEPLOYMENT_INVALID_VALUE',
      '$.datasets[0].metrics[0].grains',
    );
  });

  it('requires a dataset time field for a valid grained metric', () => {
    const deployment = {
      ...baseDeployment(),
      datasets: [{
        ...minimalDataset(),
        metrics: [minimalMetric()],
      }],
    };

    expectDeploymentError(
      () => validateProtocolDeploymentContract(deployment),
      'HQ_DEPLOYMENT_INVALID_REFERENCE',
      '$.datasets[0].metrics[0].grains',
    );
  });

  it('accepts a grained metric with a supported grain and dataset time field', () => {
    const deployment = {
      ...baseDeployment(),
      datasets: [{
        ...minimalDataset(),
        timeField: 'created_at',
        metrics: [minimalMetric()],
      }],
    };

    expect(() => validateProtocolDeploymentContract(deployment)).not.toThrow();
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

  it('rejects duplicate method and path routes', () => {
    const namedQuery = (name: string) => ({
      name,
      input: { kind: 'void' },
      output: { kind: 'void' },
      implementation: {
        kind: 'semantic-plan',
        query: {
          kind: 'dataset', dataset: 'orders', dimensions: [], measures: [], filters: [], orderBy: [],
        },
      },
      endpoint: {
        access: { kind: 'public' },
        tenant: { kind: 'not-required' },
        method: 'GET',
        path: '/same',
      },
      tags: [],
    });
    const deployment = {
      ...baseDeployment(),
      queries: [namedQuery('first'), namedQuery('second')],
    };

    expectDeploymentError(
      () => validateProtocolDeploymentContract(deployment),
      'HQ_DEPLOYMENT_INVALID_VALUE',
      '$.queries[1].endpoint',
    );
  });
});
