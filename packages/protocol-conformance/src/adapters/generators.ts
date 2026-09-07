// Deterministic materialization of `generator` fixture cases, implemented from
// the normative fixture-README semantics (RFC 0012). Each family's generators
// mirror the transforms documented in its README; keep the two in lockstep.

type Spec = Record<string, unknown>;

function repeat(value: string, count: number): string {
  return value.repeat(count);
}

function accessorObject(kind: string, property = 'kind'): Record<string, unknown> {
  const object: Record<string, unknown> = {};
  Object.defineProperty(object, property, { enumerable: true, get: () => kind });
  return object;
}

// --- tagged-values-v1 (also used by the value-sources fuzz corpus) ---

function taggedArray(values: unknown[]): unknown {
  return { $hypequery: { type: 'array', version: 1, values } };
}

export function materializeTaggedValue(spec: Spec): unknown {
  switch (spec.type) {
    case 'nested-array': {
      let value = spec.leaf;
      for (let depth = 0; depth < (spec.depth as number); depth += 1) value = taggedArray([value]);
      return value;
    }
    case 'array':
      return taggedArray(Array.from({ length: spec.items as number }, () => spec.value));
    case 'array-tree':
      return taggedArray(
        Array.from({ length: spec.branches as number }, () =>
          taggedArray(Array.from({ length: spec.itemsPerBranch as number }, () => spec.value)),
        ),
      );
    case 'non-finite-float':
      if (spec.value === 'NaN') return Number.NaN;
      if (spec.value === 'Infinity') return Number.POSITIVE_INFINITY;
      if (spec.value === '-Infinity') return Number.NEGATIVE_INFINITY;
      throw new Error(`Unknown non-finite float: ${String(spec.value)}`);
    case 'repeat-string':
      return repeat(spec.utf8 as string, spec.count as number);
    case 'unsafe-accessor': {
      // `$hypequery` served by a computed accessor instead of a data
      // property. A validator must snapshot without invoking it and reject.
      const value: Record<string, unknown> = {};
      Object.defineProperty(value, '$hypequery', {
        enumerable: true,
        get: () => ({
          type: 'uuid',
          version: 1,
          value: '01890f3e-7b7b-7cc2-98c4-dc0c0c07398f',
        }),
      });
      return value;
    }
    default:
      throw new Error(`Unknown tagged-value generator: ${String(spec.type)}`);
  }
}

// --- identifiers-v1 ---

export function materializeIdentifier(spec: Spec): string {
  if (spec.type === 'repeat-string') return repeat(spec.value as string, spec.count as number);
  if (spec.type === 'qualified-segments') {
    return Array.from({ length: spec.count as number }, () => spec.segment as string).join('.');
  }
  throw new Error(`Unknown identifier generator: ${String(spec.type)}`);
}

// --- expressions-v1 ---

const EXPR_LITERAL = { kind: 'literal', value: false };

export function materializeExpression(spec: Spec): unknown {
  switch (spec.type) {
    case 'nested-not': {
      let value: unknown = EXPR_LITERAL;
      for (let i = 0; i < (spec.depth as number); i += 1) {
        value = { kind: 'logical', operator: 'not', operand: value };
      }
      return value;
    }
    case 'logical-operands':
      return {
        kind: 'logical',
        operator: 'and',
        operands: Array.from({ length: spec.count as number }, () => ({ ...EXPR_LITERAL })),
      };
    case 'logical-tree':
      return {
        kind: 'logical',
        operator: 'and',
        operands: Array.from({ length: 10 }, (_, groupIndex) => ({
          kind: 'logical',
          operator: 'and',
          operands: Array.from(
            { length: groupIndex === 9 ? spec.lastGroupItems as number : 100 },
            () => ({ ...EXPR_LITERAL }),
          ),
        })),
      };
    case 'unsafe-accessor': {
      const value: Record<string, unknown> = { kind: 'reference' };
      Object.defineProperty(value, 'name', { enumerable: true, get: () => 'orders' });
      return value;
    }
    default:
      throw new Error(`Unknown expression generator: ${String(spec.type)}`);
  }
}

// --- query-schemas-v1 ---

export function materializeSchema(spec: Spec): unknown {
  switch (spec.type) {
    case 'nested-array': {
      let value: unknown = { kind: 'any' };
      for (let i = 0; i < (spec.depth as number); i += 1) value = { kind: 'array', items: value };
      return value;
    }
    case 'union-tree':
      return {
        kind: 'union',
        variants: Array.from({ length: 10 }, () => ({
          kind: 'union',
          variants: Array.from({ length: 100 }, () => ({ kind: 'any' })),
        })),
      };
    case 'enum-values':
      return {
        kind: 'enum',
        values: Array.from({ length: spec.count as number }, (_, i) => `v${i}`),
      };
    case 'description':
      return { kind: 'string', description: repeat('a', spec.bytes as number) };
    case 'unsafe-accessor':
      return accessorObject('string');
    default:
      throw new Error(`Unknown schema generator: ${String(spec.type)}`);
  }
}

// --- query-implementations-v1 ---

function compiledSql(parameters: unknown[]): Record<string, unknown> {
  return {
    kind: 'compiled-sql',
    dialect: 'clickhouse',
    operation: 'select',
    statement: 'SELECT 1',
    parameters,
    readSources: [],
    tenant: { kind: 'not-required' },
  };
}

export function materializeImplementation(spec: Spec): unknown {
  switch (spec.type) {
    case 'parameters':
      return compiledSql(
        Array.from({ length: spec.count as number }, (_, i) => ({
          name: `param${i}`,
          source: { kind: 'input', path: `param${i}` },
          clickHouseType: 'String',
        })),
      );
    case 'sql-expression':
      return {
        kind: 'sql-expression',
        dialect: 'clickhouse',
        sql: repeat('a', spec.bytes as number),
        output: { kind: 'string' },
        dependencies: [],
      };
    case 'unsafe-accessor':
      return accessorObject('semantic-plan');
    default:
      throw new Error(`Unknown implementation generator: ${String(spec.type)}`);
  }
}

// --- query-events-v1 ---

function baseEvent(): Record<string, unknown> {
  return {
    kind: 'hypequery-query-event',
    version: 1,
    eventId: '0'.repeat(64),
    occurredAt: '2026-07-20T12:34:56.789Z',
    target: { project: 'project_1', environment: 'production' },
    queryName: 'daily_revenue',
    operation: 'query',
    outcome: 'success',
    durationMs: 182,
  };
}

export function materializeEvent(spec: Spec): unknown {
  const value = baseEvent();
  switch (spec.type) {
    case 'wrong-root-type': return [];
    case 'missing-required-field': { delete value.durationMs; return value; }
    case 'unknown-sql-field': return { ...value, sql: 'SELECT 1' };
    case 'unknown-parameters-field': return { ...value, parameters: { start: '2026-01-01' } };
    case 'unknown-raw-tenant-field': return { ...value, tenantId: 'acme' };
    case 'newer-version': return { ...value, version: 2 };
    case 'malformed-event-id': return { ...value, eventId: 'bad' };
    case 'invalid-occurred-at': return { ...value, occurredAt: '2026-13-40T99:99:99Z' };
    case 'failure-without-category': return { ...value, outcome: 'failure' };
    case 'success-with-category': return { ...value, errorCategory: 'internal' };
    case 'unknown-error-category': return { ...value, outcome: 'failure', errorCategory: 'exploded' };
    case 'negative-duration': return { ...value, durationMs: -1 };
    case 'invalid-target': return { ...value, target: { project: 'has space', environment: 'production' } };
    case 'invalid-query-name': return { ...value, queryName: 'not an identifier' };
    case 'oversized-correlation-id': return { ...value, correlationId: repeat('x', 2_049) };
    case 'unsafe-accessor': {
      const unsafe = baseEvent();
      Object.defineProperty(unsafe, 'kind', { enumerable: true, get: () => 'hypequery-query-event' });
      return unsafe;
    }
    default: throw new Error(`Unknown event generator: ${String(spec.type)}`);
  }
}

// --- query-diagnostics-v1 ---

function baseDiagnostics(): Record<string, unknown> {
  return {
    kind: 'hypequery-query-diagnostics',
    version: 1,
    eventId: '0'.repeat(64),
    queryId: '1'.repeat(64),
    terminalReason: 'completed',
    attempts: 1,
  };
}

export function materializeDiagnostics(spec: Spec): unknown {
  const value = baseDiagnostics();
  switch (spec.type) {
    case 'wrong-root-type': return [];
    case 'missing-required-field': { delete value.attempts; return value; }
    case 'unknown-result-field': return { ...value, rows: [[1, 2]] };
    case 'unknown-credentials-field': return { ...value, password: 'hunter2' };
    case 'newer-version': return { ...value, version: 2 };
    case 'malformed-query-id': return { ...value, queryId: 'bad' };
    case 'unknown-terminal-reason': return { ...value, terminalReason: 'exploded' };
    case 'zero-attempts': return { ...value, attempts: 0 };
    case 'control-character-message': return { ...value, safeMessage: 'bad\u0007message' };
    case 'oversized-debug-query': return { ...value, debugQuery: repeat('x', 4_097) };
    case 'unsafe-accessor': {
      const unsafe = baseDiagnostics();
      Object.defineProperty(unsafe, 'kind', { enumerable: true, get: () => 'hypequery-query-diagnostics' });
      return unsafe;
    }
    default: throw new Error(`Unknown diagnostics generator: ${String(spec.type)}`);
  }
}

// --- deployments-v1 ---

function minimalDataset(name = 'orders'): Record<string, unknown> {
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

function baseDeployment(): Record<string, unknown> {
  return {
    kind: 'hypequery-deployment',
    version: 1,
    datasets: [minimalDataset()],
    queries: [],
    artifacts: [],
  };
}

export function materializeDeployment(spec: Spec): unknown {
  const value = baseDeployment();
  switch (spec.type) {
    case 'wrong-root-type': return [];
    case 'unknown-root-field': return { ...value, extra: true };
    case 'unsupported-version': return { ...value, version: 2 };
    case 'invalid-dataset-identifier': return { ...value, datasets: [minimalDataset('bad-name')] };
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
            kind: 'runtime-reference', runtime: 'node', artifactSha256: '0'.repeat(64), entrypoint: 'queries.health',
          },
          endpoint: { access: { kind: 'public' }, tenant: { kind: 'not-required' }, method: 'GET', path: '/health' },
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
          query: { kind: 'dataset', dataset: 'orders', dimensions: [], measures: [], filters: [], orderBy: [] },
        },
        endpoint: { access: { kind: 'public' }, tenant: { kind: 'not-required' }, method: 'GET', path: '/same' },
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
      // `timeField`, so the reference reports it as a broken reference.
      return { ...value, datasets: [{ ...minimalDataset(), defaults: { timeGrain: 'day' } }] };
    case 'too-many-datasets':
      return { ...value, datasets: Array.from({ length: 101 }, (_, i) => minimalDataset(`dataset_${i}`)) };
    case 'too-many-synonyms':
      return {
        ...value,
        datasets: [{
          ...minimalDataset(),
          synonyms: Array.from({ length: 101 }, (_, i) => `synonym_${i}`),
        }],
      };
    case 'source-too-large':
      return { ...value, datasets: [{ ...minimalDataset(), source: repeat('a', 1_025) }] };
    case 'unsafe-accessor': {
      const unsafe = baseDeployment();
      Object.defineProperty(unsafe, 'kind', { enumerable: true, get: () => 'hypequery-deployment' });
      return unsafe;
    }
    default: throw new Error(`Unknown deployment generator: ${String(spec.type)}`);
  }
}

// --- deployment-bundles-v1 ---

function bundleArtifact(index = 0): Record<string, unknown> {
  const sha256 = index.toString(16).padStart(64, '0');
  return { runtime: 'node', path: `artifacts/${sha256}.mjs`, sha256, byteLength: 1 };
}

function baseManifest(): Record<string, unknown> {
  return {
    kind: 'hypequery-deployment-bundle',
    version: 1,
    deployment: { path: 'deployment.json', identity: '1'.repeat(64), sha256: '2'.repeat(64), byteLength: 1 },
    artifacts: [bundleArtifact()],
  };
}

export function materializeBundle(spec: Spec): unknown {
  const value = baseManifest();
  const deployment = value.deployment as Record<string, unknown>;
  switch (spec.type) {
    case 'wrong-root-type': return [];
    case 'unknown-root-field': return { ...value, extra: true };
    case 'unsupported-version': return { ...value, version: 2 };
    case 'malformed-digest': return { ...value, deployment: { ...deployment, identity: 'bad' } };
    case 'traversal-path': return { ...value, deployment: { ...deployment, path: '../deployment.json' } };
    case 'duplicate-path': return { ...value, artifacts: [{ ...bundleArtifact(), path: deployment.path }] };
    case 'too-many-artifacts': return { ...value, artifacts: Array.from({ length: 101 }, (_, i) => bundleArtifact(i)) };
    case 'deployment-too-large': return { ...value, deployment: { ...deployment, byteLength: (16 * 1024 * 1024) + 1 } };
    case 'unsafe-accessor': {
      const unsafe = baseManifest();
      Object.defineProperty(unsafe, 'kind', { enumerable: true, get: () => 'hypequery-deployment-bundle' });
      return unsafe;
    }
    default: throw new Error(`Unknown bundle generator: ${String(spec.type)}`);
  }
}

// --- deployment-releases-v1 ---

function baseRelease(): Record<string, unknown> {
  return {
    kind: 'hypequery-deployment-release',
    version: 1,
    bundleIdentity: '0'.repeat(64),
    target: { project: 'project_1', environment: 'production' },
  };
}

export function materializeRelease(spec: Spec): unknown {
  const value = baseRelease();
  const target = value.target as Record<string, unknown>;
  switch (spec.type) {
    case 'wrong-root-type': return [];
    case 'unknown-root-field': return { ...value, extra: true };
    case 'unsupported-version': return { ...value, version: 2 };
    case 'malformed-bundle-identity': return { ...value, bundleIdentity: 'bad' };
    case 'target-too-large': return { ...value, target: { ...target, project: `p${repeat('a', 128)}` } };
    case 'unsafe-accessor': {
      const unsafe = baseRelease();
      Object.defineProperty(unsafe, 'kind', { enumerable: true, get: () => 'hypequery-deployment-release' });
      return unsafe;
    }
    default: throw new Error(`Unknown release generator: ${String(spec.type)}`);
  }
}
