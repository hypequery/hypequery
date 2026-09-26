/**
 * HQ-45: the decision 0005 byte-identical gate, extended from customer-shaped
 * schemas rather than from the feature list that already passes.
 *
 * `sql-equality.test.ts` proves every contract feature on one synthetic model.
 * This suite runs the same comparison over two schemas shaped like real
 * deployments — a per-customer product analytics warehouse with no tenant
 * column, and a single customer serving many merchants from shared tables —
 * so the corpus covers the combinations those shapes produce: SQL dimensions
 * feeding measures, filtered distinct counts, derived measures, two
 * relationships off one dataset, and tenant predicates through each join.
 *
 * The second half pins down exclusions. Every surface portable execution
 * refuses must name a reason from `UNSUPPORTED_CONTRACT_REASONS`, and every
 * reason must be reachable from a contract a customer could deploy.
 */

import { describe, expect, it } from 'vitest';
import { createDatasetClient } from './executor.js';
import {
  createPortableSemanticExecutor,
  PortableExecutionUnsupportedError,
} from './portable-executor.js';
import { buildProtocolDatasetContract } from './protocol-adapter.js';
import { buildProtocolDeploymentContract } from './protocol-deployment-adapter.js';
import {
  rehydrateProtocolDatasets,
  UNSUPPORTED_CONTRACT_REASONS,
  UnsupportedContractFeatureError,
  type UnsupportedContractReason,
} from './protocol-rehydrate.js';
import type { AnyDatasetInstance, MetricHandle, TimeGrain } from './types.js';
import { createRenderingBuilderFactory, subsets } from './tests/support/sql-equality-harness.js';
import { LineItems, Buyers, Products, marketplaceMetrics } from './tests/support/corpus-schemas/marketplace.js';
import { Accounts, Events, productMetrics } from './tests/support/corpus-schemas/product-analytics.js';

const PUBLIC_ENDPOINT = { access: { kind: 'public' }, tenant: { kind: 'not-required' } } as const;
const GRAINS: TimeGrain[] = ['day', 'week', 'month', 'quarter', 'year'];

interface SchemaSpec {
  readonly label: string;
  /** Supporting datasets first, the queried dataset last. */
  readonly supporting: readonly AnyDatasetInstance[];
  readonly target: AnyDatasetInstance;
  readonly metrics: Record<string, MetricHandle>;
  readonly groupable: readonly string[];
  readonly joined: readonly string[];
  /** A measure the joins can carry: SQL-backed dimensions cannot be joined. */
  readonly joinMeasure: string;
  /** A groupable or measured SQL-backed dimension, which joins must refuse. */
  readonly sqlBacked: { readonly dimensions?: string[]; readonly measures?: string[] };
  /** Set when the authored metrics refuse joins too, because of `sqlBacked`. */
  readonly metricsRefuseJoins?: boolean;
  readonly filterValues: Record<string, Record<string, unknown>>;
  /** Absent for a schema with no tenant column: nothing to scope by. */
  readonly tenants?: readonly { readonly label: string; readonly runtime: unknown }[];
}

const SCHEMAS: readonly SchemaSpec[] = [
  {
    label: 'product analytics (per-customer)',
    supporting: [Accounts],
    target: Events,
    metrics: productMetrics,
    groupable: ['eventTime', 'accountId', 'userId', 'eventName', 'platform', 'country', 'isMobile'],
    joined: ['account.plan', 'account.industry'],
    joinMeasure: 'events',
    sqlBacked: { dimensions: ['isMobile'], measures: ['events'] },
    filterValues: {
      eventName: { eq: 'signup', neq: 'heartbeat', in: ['signup', 'activated'], notIn: ['heartbeat'] },
      platform: { eq: 'ios', in: ['ios', 'android'] },
      country: { eq: 'GB', in: ['GB', 'IE'], like: 'G%' },
      eventTime: { gte: '2026-09-01', lt: '2026-10-01', between: ['2026-09-01', '2026-10-01'] },
    },
  },
  {
    label: 'marketplace (multi-tenant)',
    supporting: [Buyers, Products],
    target: LineItems,
    metrics: marketplaceMetrics,
    groupable: ['orderedAt', 'buyerId', 'sku', 'currency', 'fulfilment', 'channel'],
    joined: ['buyer.segment', 'buyer.country', 'product.brand', 'product.category'],
    joinMeasure: 'units',
    sqlBacked: { measures: ['gmv'] },
    // Every marketplace metric is built on GMV, which is SQL-backed.
    metricsRefuseJoins: true,
    filterValues: {
      fulfilment: { eq: 'shipped', neq: 'refunded', in: ['shipped', 'delivered'] },
      channel: { eq: 'web', notIn: ['pos'] },
      currency: { eq: 'GBP' },
      orderedAt: { gt: '2026-09-01', lte: '2026-09-30', between: ['2026-09-01', '2026-09-30'] },
    },
    tenants: [
      { label: 'one merchant', runtime: 'merchant-7f3a' },
      { label: 'merchant object', runtime: { id: 'merchant-7f3a' } },
      { label: 'merchant list', runtime: { in: ['merchant-7f3a', 'merchant-19c0'] } },
      { label: 'all merchants', runtime: { scope: 'all' as const } },
    ],
  },
];

interface Case {
  readonly name: string;
  readonly query: Record<string, unknown>;
  readonly tenant?: unknown;
  readonly metric?: string;
  /** Both catalogs must refuse, with the same error; SQL is not compared. */
  readonly expectedRejection?: string | RegExp;
  /** The authored catalog compiles; the rebuilt one must refuse with this. */
  readonly knownDivergence?: RegExp;
}

function corpus(spec: SchemaSpec): Case[] {
  const cases: Case[] = [];
  const [firstMeasure] = Object.keys(spec.target.measures);
  const anchor = spec.groupable.find(name => name !== spec.target.timeKey)!;

  for (let size = 1; size <= Math.min(3, spec.groupable.length); size++) {
    for (const dimensions of subsets(spec.groupable, size)) {
      cases.push({ name: `dimensions ${dimensions.join('+')}`, query: { dimensions, measures: [firstMeasure] } });
    }
  }

  const measures = Object.keys(spec.target.measures);
  for (const name of measures) {
    cases.push({ name: `measure ${name}`, query: { dimensions: [anchor], measures: [name] } });
  }
  for (const pair of subsets(measures, 2)) {
    cases.push({ name: `measures ${pair.join('+')}`, query: { dimensions: [anchor], measures: pair } });
  }

  for (const [field, definition] of Object.entries(spec.target.filters)) {
    for (const operator of definition.operators ?? []) {
      const value = spec.filterValues[field]?.[operator];
      if (value === undefined) throw new Error(`No corpus value for ${field} ${operator}.`);
      cases.push({
        name: `filter ${field} ${operator}`,
        query: { dimensions: [anchor], measures: [firstMeasure], filters: [{ field, operator, value }] },
      });
    }
  }

  for (const grain of GRAINS) {
    cases.push({ name: `grain ${grain}`, query: { measures: [firstMeasure], by: grain } });
    cases.push({ name: `grain ${grain} with dimension`, query: { dimensions: [anchor], measures: measures.slice(0, 3), by: grain } });
  }

  for (const field of [anchor, firstMeasure, 'period']) {
    for (const direction of ['asc', 'desc'] as const) {
      cases.push({
        name: `order ${field} ${direction}`,
        query: {
          dimensions: [anchor],
          measures: [firstMeasure],
          ...(field === 'period' ? { by: 'week' as TimeGrain } : {}),
          orderBy: [{ field, direction }],
        },
      });
    }
  }

  for (const [limit, offset] of [[25, 0], [100, 200], [1, 0], [spec.target.limits?.maxResultSize ?? 1_000, 0]]) {
    cases.push({
      name: `page limit=${limit} offset=${offset}`,
      query: { dimensions: [anchor], measures: [firstMeasure], limit, offset },
    });
  }

  for (const joined of spec.joined) {
    cases.push(
      { name: `join ${joined}`, query: { dimensions: [joined], measures: [spec.joinMeasure] } },
      { name: `join ${joined} with local`, query: { dimensions: [anchor, joined], measures: [spec.joinMeasure] } },
      {
        name: `join ${joined} filtered and ordered`,
        query: {
          dimensions: [joined],
          measures: [spec.joinMeasure],
          filters: [{ field: joined, operator: 'eq', value: 'x' }],
          orderBy: [{ field: joined, direction: 'desc' }],
        },
      },
    );
  }
  cases.push({ name: 'join every relationship at once', query: { dimensions: [...spec.joined], measures: [spec.joinMeasure] } });

  // Found by this corpus: a SQL-backed dimension cannot ride a join, because
  // its expression is not table-qualified. Authored and rebuilt catalogs must
  // refuse it identically; a rebuild that accepted it would be a divergence.
  cases.push({
    name: `join refuses SQL-backed ${JSON.stringify(spec.sqlBacked)}`,
    query: {
      dimensions: [spec.joined[0], ...(spec.sqlBacked.dimensions ?? [])],
      measures: spec.sqlBacked.measures ?? [spec.joinMeasure],
    },
    expectedRejection: /SQL-backed dimension ".+" cannot be combined with relationship joins/,
  });

  for (const tenant of spec.tenants ?? []) {
    cases.push({ name: `tenant ${tenant.label}`, query: { dimensions: [anchor], measures: [firstMeasure] }, tenant: tenant.runtime });
    for (const joined of spec.joined) {
      cases.push({
        name: `tenant ${tenant.label} over ${joined}`,
        query: { dimensions: [joined], measures: [spec.joinMeasure] },
        tenant: tenant.runtime,
      });
    }
    cases.push({
      name: `tenant ${tenant.label} over every relationship`,
      query: { dimensions: [...spec.joined], measures: [spec.joinMeasure] },
      tenant: tenant.runtime,
    });
  }

  for (const [metric, handle] of Object.entries(spec.metrics)) {
    cases.push({ name: `metric ${metric}`, query: {}, metric });
    cases.push({ name: `metric ${metric} grouped`, query: { dimensions: [anchor] }, metric });
    // Known divergence, found by this corpus: an authored metric accepts a
    // joined dimension, but the contract publishes only a metric's local
    // dimensions, so the rebuilt metric refuses it. The rebuild fails closed
    // (never different SQL); the case is pinned so either side changing is
    // caught.
    cases.push({
      name: `metric ${metric} over a join (known divergence)`,
      query: { dimensions: [spec.joined[0]] },
      metric,
      knownDivergence: /is not published for this metric/,
    });
    for (const grain of GRAINS) {
      cases.push({
        name: `metric ${metric} by ${grain}`,
        query: { by: grain },
        metric,
        ...(handle.__type === 'grained_metric_ref' && grain !== handle.grain
          ? { expectedRejection: `Invalid metric query: Metric "${metric}" is already grained by "${handle.grain}" and cannot be queried with by="${grain}".` }
          : {}),
      });
    }
    for (const tenant of spec.tenants ?? []) {
      cases.push({ name: `metric ${metric} for ${tenant.label}`, query: { dimensions: [anchor] }, metric, tenant: tenant.runtime });
    }
  }

  return cases;
}

function contractsFor(spec: SchemaSpec) {
  return [
    ...spec.supporting.map(item => buildProtocolDatasetContract(item as never, { endpoint: PUBLIC_ENDPOINT as never })),
    buildProtocolDatasetContract(spec.target as never, {
      endpoint: PUBLIC_ENDPOINT as never,
      metrics: spec.metrics as never,
      metricEndpoints: Object.fromEntries(Object.keys(spec.metrics).map(name => [name, PUBLIC_ENDPOINT])) as never,
    }),
  ];
}

function compile(client: ReturnType<typeof createDatasetClient>, target: unknown, testCase: Case, tenanted: boolean) {
  const tenant = testCase.tenant ?? (tenanted ? 'merchant-7f3a' : undefined);
  return `SQL ${client.toSQL(
    target as never,
    testCase.query as never,
    tenant === undefined ? undefined : { runtime: { tenant: tenant as never } },
  )}`;
}

describe.each(SCHEMAS)('rehydrated $label emits byte-identical SQL', spec => {
  const rehydrated = rehydrateProtocolDatasets(contractsFor(spec));
  const rebuiltTarget = rehydrated[spec.target.name];
  const authoredClient = createDatasetClient({ queryBuilder: createRenderingBuilderFactory() });
  const rehydratedClient = createDatasetClient({ queryBuilder: createRenderingBuilderFactory() });
  const tenanted = spec.tenants !== undefined;
  const cases = corpus(spec);

  it('covers every axis, every metric, and every relationship', () => {
    const names = cases.map(entry => entry.name);
    for (const axis of ['dimensions ', 'measure ', 'measures ', 'filter ', 'grain ', 'order ', 'page ', 'join ', 'metric ']) {
      expect(names.filter(name => name.startsWith(axis)).length).toBeGreaterThan(0);
    }
    if (tenanted) expect(names.filter(name => name.startsWith('tenant ')).length).toBeGreaterThan(spec.joined.length);
    for (const metric of Object.keys(spec.metrics)) {
      expect(names.filter(name => name.startsWith(`metric ${metric} `)).length).toBeGreaterThan(GRAINS.length);
    }
    const grained = Object.values(spec.metrics).filter(metric => metric.__type === 'grained_metric_ref');
    expect(grained.length).toBeGreaterThan(0);
    expect(cases.filter(entry => typeof entry.expectedRejection === 'string')).toHaveLength(grained.length * (GRAINS.length - 1));
    // Divergences are only ever the one pinned below, never a new silent one.
    expect(cases.filter(entry => entry.knownDivergence !== undefined)).toHaveLength(Object.keys(spec.metrics).length);
    expect(new Set(names).size).toBe(names.length);
    expect(cases.length).toBeGreaterThan(150);
  });

  it.each(cases)('$name', testCase => {
    const authoredTarget = testCase.metric === undefined ? spec.target : spec.metrics[testCase.metric];
    const rehydratedTarget = testCase.metric === undefined ? rebuiltTarget : rebuiltTarget.metrics[testCase.metric];

    if (testCase.knownDivergence !== undefined) {
      if (spec.metricsRefuseJoins) {
        expect(() => compile(authoredClient, authoredTarget, testCase, tenanted))
          .toThrow(/SQL-backed dimension ".+" cannot be combined with relationship joins/);
      } else {
        expect(compile(authoredClient, authoredTarget, testCase, tenanted)).toContain('JOIN');
      }
      expect(() => compile(rehydratedClient, rehydratedTarget, testCase, tenanted)).toThrow(testCase.knownDivergence);
      return;
    }
    if (testCase.expectedRejection !== undefined) {
      for (const [client, target] of [[authoredClient, authoredTarget], [rehydratedClient, rehydratedTarget]] as const) {
        expect(() => compile(client, target, testCase, tenanted)).toThrow(
          typeof testCase.expectedRejection === 'string' ? new Error(testCase.expectedRejection) : testCase.expectedRejection,
        );
      }
      const refusal = (client: typeof authoredClient, target: unknown) => {
        try {
          return compile(client, target, testCase, tenanted);
        } catch (error) {
          return `REFUSED ${(error as Error).message}`;
        }
      };
      expect(refusal(rehydratedClient, rehydratedTarget)).toBe(refusal(authoredClient, authoredTarget));
      return;
    }
    const authoredSql = compile(authoredClient, authoredTarget, testCase, tenanted);
    expect(authoredSql).toContain(`FROM ${spec.target.source}`);
    expect(compile(rehydratedClient, rehydratedTarget, testCase, tenanted)).toBe(authoredSql);
  });

  it('scopes tenanted queries through every join and leaves the untenanted schema unscoped', () => {
    const sql = compile(authoredClient, spec.target, {
      name: 'scope',
      query: { dimensions: [...spec.joined], measures: [spec.joinMeasure] },
    }, tenanted);
    const tenantPredicates = sql.match(/merchant_id = 'merchant-7f3a'/g) ?? [];
    // One predicate on the base table plus one per joined tenant-scoped table.
    const joinedTables = new Set(spec.joined.map(field => field.split('.')[0])).size;
    expect(tenantPredicates).toHaveLength(tenanted ? 1 + joinedTables : 0);
  });
});

// ---------------------------------------------------------------------------
// Exclusions: each named reason, reached from a customer-shaped contract.
// ---------------------------------------------------------------------------

const marketplace = contractsFor(SCHEMAS[1]);
const lineItems = marketplace[marketplace.length - 1];

function withLineItems(patch: (contract: typeof lineItems) => unknown) {
  return [...marketplace.slice(0, -1), patch(structuredClone(lineItems))] as never;
}

function metricNamed(contract: typeof lineItems, name: string) {
  return contract.metrics.find(metric => String(metric.name) === name)!;
}

const REHYDRATION_EXCLUSIONS: ReadonlyArray<{
  readonly reason: UnsupportedContractReason;
  readonly scenario: string;
  readonly contracts: () => never;
}> = [
  {
    reason: UNSUPPORTED_CONTRACT_REASONS.measureFilterNotComparison,
    scenario: 'refunded GMV filtered by a logical expression instead of a comparison',
    contracts: () => withLineItems(contract => {
      const refunded = contract.measures.find(item => String(item.name) === 'refundedGmv')!;
      (refunded as { filters: unknown[] }).filters = [
        { kind: 'logical', operator: 'not', operand: refunded.filters[0] },
      ];
      return contract;
    }),
  },
  {
    reason: UNSUPPORTED_CONTRACT_REASONS.expressionNotAggregate,
    scenario: 'a derived metric input that is a reference rather than an aggregate',
    contracts: () => withLineItems(contract => {
      const aov = metricNamed(contract, 'averageOrderValue');
      (aov.derivation!.inputs[0] as { expression: unknown }).expression = { kind: 'reference', name: 'gmv' };
      return contract;
    }),
  },
  {
    reason: UNSUPPORTED_CONTRACT_REASONS.noMatchingMeasure,
    scenario: 'a GMV metric whose measure was removed from the dataset',
    contracts: () => withLineItems(contract => ({
      ...contract,
      measures: contract.measures.filter(item => String(item.name) !== 'gmv'),
      derivedMeasures: [],
      metrics: contract.metrics.filter(metric => String(metric.name) === 'gmv'),
    })),
  },
  {
    reason: UNSUPPORTED_CONTRACT_REASONS.ambiguousMeasureSql,
    scenario: 'two units measures with the same aggregation but different SQL',
    contracts: () => withLineItems(contract => {
      const units = contract.measures.find(item => String(item.name) === 'units')!;
      return {
        ...contract,
        measures: [...contract.measures, { ...units, name: 'unitsNet', sql: { sql: 'sum(quantity) - 1', dependencies: ['quantity'] } }],
        metrics: [{ ...metricNamed(contract, 'gmv'), name: 'units', expression: { kind: 'aggregate', aggregation: 'sum', field: 'quantity' } }],
      };
    }),
  },
  {
    reason: UNSUPPORTED_CONTRACT_REASONS.derivedMetricWithoutFormula,
    scenario: 'average order value published by a writer that predates derivations',
    contracts: () => withLineItems(contract => {
      const { derivation: _derivation, ...aov } = metricNamed(contract, 'averageOrderValue');
      return { ...contract, metrics: [aov] };
    }),
  },
  {
    reason: UNSUPPORTED_CONTRACT_REASONS.unsupportedFormula,
    scenario: 'a discount rate formula calling a function portable execution has no builder for',
    contracts: () => withLineItems(contract => {
      const rate = metricNamed(contract, 'discountRate');
      (rate.derivation as { expression: unknown }).expression = {
        kind: 'call', function: 'log', args: [{ kind: 'reference', name: 'gmv' }],
      };
      return { ...contract, metrics: [rate] };
    }),
  },
  {
    reason: UNSUPPORTED_CONTRACT_REASONS.relationshipTargetMissing,
    scenario: 'line items deployed without the buyers dataset they join to',
    contracts: () => [marketplace[1], lineItems] as never,
  },
];

function reasonOf(run: () => unknown): UnsupportedContractReason | undefined {
  try {
    const registry = run() as Record<string, { relationships?: Record<string, { target(): unknown }> }>;
    // A relationship target resolves lazily, on first use.
    for (const entry of Object.values(registry)) {
      for (const relationship of Object.values(entry.relationships ?? {})) relationship.target();
    }
  } catch (error) {
    expect(error).toBeInstanceOf(UnsupportedContractFeatureError);
    return (error as UnsupportedContractFeatureError).reason;
  }
  return undefined;
}

describe('portable execution names every exclusion', () => {
  it.each(REHYDRATION_EXCLUSIONS)('$reason: $scenario', ({ reason, contracts }) => {
    expect(reasonOf(() => rehydrateProtocolDatasets(contracts()))).toBe(reason);
  });

  it('accepts the unmodified customer-shaped contracts', () => {
    expect(reasonOf(() => rehydrateProtocolDatasets(marketplace))).toBeUndefined();
    expect(reasonOf(() => rehydrateProtocolDatasets(contractsFor(SCHEMAS[0])))).toBeUndefined();
  });

  describe('at invocation', () => {
    const deployment = () => buildProtocolDeploymentContract([Buyers, Products, LineItems], {
      endpoints: Object.fromEntries(['buyers', 'products', 'lineItems'].map(name => [name, {
        access: { kind: 'authenticated', roles: [], scopes: [] },
        tenant: { kind: 'required', mode: 'auto-inject', column: 'merchant_id' },
      }])) as never,
    });
    const execute = createPortableSemanticExecutor({ queryBuilder: createRenderingBuilderFactory() });
    function invoke(overrides: Record<string, unknown>, contract = deployment()) {
      const dataset = contract.datasets.find(item => String(item.name) === 'lineItems')!;
      return execute({
        activationRevision: 'b'.repeat(64),
        deployment: contract,
        dataset,
        operation: { kind: 'dataset', dataset: 'lineItems', measures: ['gmv'] },
        tenant: 'merchant-7f3a',
        budget: { maxRows: 100 },
        ...overrides,
      } as never);
    }
    async function refusal(run: Promise<unknown>) {
      const error = await run.then(() => undefined, (caught: unknown) => caught);
      expect(error).toBeInstanceOf(PortableExecutionUnsupportedError);
      const unsupported = error as PortableExecutionUnsupportedError;
      expect(unsupported.code).toBe('HQ_SEMANTIC_UNSUPPORTED_CAPABILITY');
      return unsupported.reason;
    }

    it('carries the rehydration reason to the unsupported-capability failure', async () => {
      // A release whose refunded-GMV filter arrived as a logical expression.
      const contract = structuredClone(deployment());
      const refunded = contract.datasets
        .find(item => String(item.name) === 'lineItems')!.measures
        .find(item => String(item.name) === 'refundedGmv') as { filters: unknown[] };
      refunded.filters = [{ kind: 'logical', operator: 'not', operand: refunded.filters[0] }];
      await expect(refusal(invoke({}, contract as never)))
        .resolves.toBe(UNSUPPORTED_CONTRACT_REASONS.measureFilterNotComparison);
    });

    it(`${UNSUPPORTED_CONTRACT_REASONS.queryFilterNotComparison}: a merchant filter sent as a logical expression`, async () => {
      await expect(refusal(invoke({
        operation: {
          kind: 'dataset', dataset: 'lineItems', measures: ['gmv'],
          filters: [{ kind: 'logical', operator: 'not', operand: { kind: 'literal', value: true } }],
        },
      }))).resolves.toBe(UNSUPPORTED_CONTRACT_REASONS.queryFilterNotComparison);
    });

    it(`${UNSUPPORTED_CONTRACT_REASONS.datasetNotActivated}: a dataset outside the activated release`, async () => {
      const contract = deployment();
      await expect(refusal(invoke({
        dataset: { ...contract.datasets[2], name: 'payouts' },
        operation: { kind: 'dataset', dataset: 'payouts', measures: ['gmv'] },
      }, contract))).resolves.toBe(UNSUPPORTED_CONTRACT_REASONS.datasetNotActivated);
    });
  });

  it('exercises every named reason', () => {
    const covered = new Set<string>([
      ...REHYDRATION_EXCLUSIONS.map(entry => entry.reason),
      UNSUPPORTED_CONTRACT_REASONS.queryFilterNotComparison,
      UNSUPPORTED_CONTRACT_REASONS.datasetNotActivated,
    ]);
    expect([...covered].sort()).toEqual(Object.values(UNSUPPORTED_CONTRACT_REASONS).sort());
  });
});
