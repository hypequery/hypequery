/**
 * `query_dataset` analysis features (RFC 0026, RFC 0029): what the tool
 * advertises, what it accepts and refuses, and a round trip from MCP
 * arguments through the dataset client and through the protocol operation a
 * semantic data plane runs.
 */

import { createQueryBuilder } from '@hypequery/clickhouse';
import {
  buildProtocolDeploymentContract,
  createDatasetClient,
  createPortableSemanticRuntime,
  dataset,
  dimension,
  measure,
  toProtocolDatasetQuery,
} from '@hypequery/datasets';
import { validateProtocolSemanticQuery } from '@hypequery/protocol';
import Ajv from 'ajv';
import { describe, expect, it } from 'vitest';
import { createMCPDiscoveryExecutor } from '../discovery-executor.js';
import { HypequeryMCPExecutor } from '../executor.js';
import type { MCPQueryFeatures } from '../types.js';
import { parseToolArgs } from './args.js';
import { buildMCPQuerySchemas } from './utils/canonical-query-schemas.js';
import { datasetQueryFromArgs } from './utils/dataset-query-args.js';
import { QUERY_OUTPUT_SCHEMA } from './tool-manifest.js';

const Orders = dataset('orders', {
  source: 'orders',
  timeKey: 'createdAt',
  timeKeys: ['shippedAt'],
  dimensions: {
    createdAt: dimension.timestamp({ column: 'created_at' }),
    shippedAt: dimension.timestamp({ column: 'shipped_at' }),
    country: dimension.string(),
    channel: dimension.string(),
    status: dimension.string(),
    amount: dimension.number(),
  },
  measures: {
    revenue: measure.sum('amount'),
    orders: measure.count('status'),
    customers: measure.countDistinct('country'),
  },
});

const NOW = new Date('2026-11-22T12:00:00Z');

function recording(rows: Record<string, unknown>[] = []) {
  const sql: string[] = [];
  const db = createQueryBuilder({
    adapter: {
      name: 'recording',
      async query<T>(statement: string, params: unknown[] = []) {
        // Bound values are recorded beside the statement, as the driver receives them.
        sql.push(`${statement} -- ${JSON.stringify(params)}`);
        return rows as T[];
      },
    },
  });
  return { db, sql };
}

function localExecutor(rows: Record<string, unknown>[] = [], queryFeatures?: MCPQueryFeatures) {
  const { db, sql } = recording(rows);
  const executor = new HypequeryMCPExecutor({
    datasets: { orders: Orders },
    analytics: createDatasetClient({ queryBuilder: db, now: () => NOW }),
    ...(queryFeatures ? { queryFeatures } : {}),
  });
  return { executor, sql };
}

async function inputSchema(executor: { listTools(): Promise<{ tools: { name: string; inputSchema: unknown }[] }> }) {
  const { tools } = await executor.listTools();
  return tools.find(tool => tool.name === 'query_dataset')!.inputSchema as Record<string, any>;
}

function errorOf(result: { structuredContent?: unknown; isError?: boolean }): { code: string; message: string } {
  expect(result.isError).toBe(true);
  return (result.structuredContent as { error: { code: string; message: string } }).error;
}

const US_OR_CA = { or: [
  { field: 'country', operator: 'eq', value: 'US' },
  { field: 'country', operator: 'eq', value: 'CA' },
] };
const NOT_REFUNDED = { not: { field: 'status', operator: 'eq', value: 'refunded' } };
const LAST_30_DAYS = { field: 'createdAt', operator: 'inDateRange', value: 'last 30 days' };

describe('query_dataset analysis features', () => {
  describe('advertised schema', () => {
    it('stays provider-safe: one object, references resolving to root definitions', async () => {
      const schema = await inputSchema(localExecutor().executor);
      expect(schema.type).toBe('object');
      for (const key of ['anyOf', 'oneOf', 'allOf']) expect(schema).not.toHaveProperty(key);
      const refs = [...JSON.stringify(schema).matchAll(/"\$ref":"#\/definitions\/([^"]+)"/g)].map(match => match[1]);
      expect(refs.length).toBeGreaterThan(0);
      for (const ref of refs) expect(schema.definitions).toHaveProperty(ref);
      expect(Object.keys(schema.properties)).toEqual([
        'dataset', 'dimensions', 'measures', 'filters', 'having', 'calculations', 'limitBy', 'other',
        'orderBy', 'limit', 'offset', 'grain', 'timeKey', 'timezone', 'fill',
      ]);
      // The size models read on every call; see the PR for the comparison.
      expect(JSON.stringify(schema).length).toBeLessThan(8_500);
      expect(schema).toMatchSnapshot();
    });

    it('compiles as JSON Schema that accepts the exact schema\'s inputs', async () => {
      const schema = await inputSchema(localExecutor().executor);
      const validate = new Ajv({ strict: false }).compile(schema);
      expect(validate({
        dataset: 'orders', dimensions: ['country'], measures: ['revenue'],
        filters: [US_OR_CA, NOT_REFUNDED, LAST_30_DAYS],
        calculations: [{ name: 'aov', formula: { op: 'divide', args: ['revenue', { op: 'nullIfZero', args: ['orders'] }] } }],
        grain: 'day', fill: true,
      })).toBe(true);
      expect(validate({ dataset: 'orders', measures: ['revenue'], filters: [{ field: 'createdAt', operator: 'inDateRange', value: 'next week' }] })).toBe(false);
    });

    it('lists the same schema on local and hosted discovery surfaces (CORE-03)', async () => {
      const local = JSON.stringify(await inputSchema(localExecutor().executor));
      const hosted = JSON.stringify(await inputSchema(createMCPDiscoveryExecutor({ datasets: { orders: Orders } })));
      expect(hosted).toBe(local);
    });

    it('leaves out calculations, limitBy and other where the executor has no extension 2', async () => {
      const hosted = createMCPDiscoveryExecutor({ datasets: { orders: Orders }, queryFeatures: { calculations: false } });
      const schema = await inputSchema(hosted);
      for (const field of ['calculations', 'limitBy', 'other']) expect(schema.properties).not.toHaveProperty(field);
      // Filter groups, relative dates, fill and timeKey are extension 1 features too.
      for (const field of ['filters', 'fill', 'timeKey']) expect(schema.properties).toHaveProperty(field);
      const { executor } = localExecutor([], { calculations: false });
      const refused = errorOf(await executor.callTool('query_dataset', {
        dataset: 'orders', measures: ['revenue'], calculations: [{ name: 'x', rank: { measure: 'revenue' } }],
      }));
      expect(refused.code).toBe('MCP_INVALID_ARGUMENTS');
    });

    it('turns every feature off independently, back to the flat schema', async () => {
      const off = { having: false, filterGroups: false, relativeDates: false, fill: false, timeKey: false, calculations: false };
      const schema = await inputSchema(localExecutor([], off).executor);
      expect(Object.keys(schema.properties)).toEqual([
        'dataset', 'dimensions', 'measures', 'filters', 'orderBy', 'limit', 'offset', 'grain', 'timezone',
      ]);
      expect(schema).not.toHaveProperty('definitions');
      expect(JSON.stringify(schema)).not.toContain('inDateRange');
    });

    it('advertises timeKey only for a dataset with alternate time axes', async () => {
      const Single = dataset('single', {
        source: 'single', timeKey: 'createdAt',
        dimensions: { createdAt: dimension.timestamp(), country: dimension.string() },
        measures: { rows: measure.count() },
      });
      const { db } = recording();
      const executor = new HypequeryMCPExecutor({ datasets: { single: Single }, analytics: createDatasetClient({ queryBuilder: db }) });
      const schema = await inputSchema(executor);
      expect(schema.properties).not.toHaveProperty('timeKey');
      expect(schema.properties).toHaveProperty('fill');
    });

    it('declares calculation metadata in the output schema', () => {
      const validate = new Ajv({ strict: false }).compile(QUERY_OUTPUT_SCHEMA);
      expect(validate({
        data: [{ country: 'US', aov: '5' }],
        meta: {
          rowCount: 1, cache: { status: 'bypass' },
          calculations: [{ name: 'aov', kind: 'formula', calculation: 'aov', type: 'number' }],
        },
      })).toBe(true);
    });
  });

  describe('acceptance and refusal', () => {
    const schemas = buildMCPQuerySchemas({ orders: Orders });
    const parse = (args: Record<string, unknown>) => parseToolArgs(schemas.queryDataset, 'query_dataset', { dataset: 'orders', measures: ['revenue'], ...args });
    const refusal = (args: Record<string, unknown>) => {
      try {
        parse(args);
      } catch (error) {
        return (error as Error).message;
      }
      throw new Error('expected a refusal');
    };

    it('keeps the flat filter form', () => {
      expect(parse({ filters: [{ field: 'country', operator: 'in', value: ['US', 'CA'] }] }).filters).toHaveLength(1);
    });

    it('accepts nested groups and checks every comparison in them', () => {
      expect(() => parse({ filters: [{ and: [US_OR_CA, NOT_REFUNDED] }] })).not.toThrow();
      expect(refusal({ filters: [{ or: [{ field: 'country', operator: 'eq', value: 'US' }, { field: 'region', operator: 'eq', value: 'x' }] }] }))
        .toContain('filters.0.or.1.field: expected one of "amount", "channel", "country", "createdAt", "shippedAt", "status"');
      expect(refusal({ filters: [{ or: [] }] })).toContain('filters.0.or');
      expect(refusal({ filters: [{ and: [US_OR_CA], or: [US_OR_CA] }] })).toContain('has a key this tool does not accept');
    });

    it('accepts inDateRange only on a time axis, with a range from the grammar', () => {
      for (const value of ['today', 'this quarter', 'last month', 'year to date', 'last 7 days', 'last 1 month']) {
        expect(() => parse({ filters: [{ field: 'shippedAt', operator: 'inDateRange', value }] })).not.toThrow();
      }
      expect(refusal({ filters: [{ field: 'createdAt', operator: 'inDateRange', value: 'last 0 days' }] })).toContain('filters.0.value');
      expect(refusal({ filters: [{ field: 'country', operator: 'inDateRange', value: 'today' }] })).toContain('filters.0');
    });

    it('refuses inDateRange on a time axis whose filter does not allow gte and lt', () => {
      const Narrow = dataset('narrow', {
        source: 'narrow', timeKey: 'createdAt',
        dimensions: { createdAt: dimension.timestamp() },
        filters: { createdAt: { field: 'createdAt', operators: ['eq'] } },
        measures: { rows: measure.count() },
      });
      const json = JSON.stringify(buildMCPQuerySchemas({ narrow: Narrow }).queryDatasetJsonSchema);
      expect(json).not.toContain('inDateRange');
    });

    it('accepts fill and timeKey, and refuses an unknown axis', () => {
      expect(parse({ grain: 'day', fill: true, timeKey: 'shippedAt' })).toMatchObject({ fill: true, timeKey: 'shippedAt' });
      expect(refusal({ timeKey: 'deliveredAt' })).toContain('timeKey');
      expect(refusal({ fill: 'yes' })).toContain('fill');
    });

    it('accepts every calculation kind and refuses an entry with no kind or two', () => {
      const calculations = [
        { name: 'web', filter: { measure: 'revenue', where: [{ field: 'channel', operator: 'eq', value: 'web' }] } },
        { name: 'prior', shift: { measure: 'revenue', amount: 1, unit: 'year' } },
        { name: 'trailing', window: { measure: 'revenue', trailing: { amount: 3, unit: 'month' } } },
        { name: 'ytd', window: { measure: 'revenue', toDate: 'year' } },
        { name: 'running', window: { measure: 'revenue', cumulative: true } },
        { name: 'aov', formula: { op: 'divide', args: ['revenue', { op: 'nullIfZero', args: ['orders'] }] } },
        { name: 'vs', compare: { to: 'previousPeriod', measures: ['revenue'] } },
        { name: 'position', rank: { measure: 'revenue', within: ['period'], direction: 'desc' } },
        { name: 'part', share: { measure: 'revenue', of: [] } },
      ];
      expect(parse({ calculations }).calculations).toHaveLength(calculations.length);
      expect(refusal({ calculations: [{ name: 'x' }] })).toContain('exactly one of');
      expect(refusal({ calculations: [{ name: 'x', rank: { measure: 'revenue' }, share: { measure: 'revenue' } }] })).toContain('exactly one of');
      expect(refusal({ calculations: [{ name: 'x', window: { measure: 'revenue', toDate: 'year', cumulative: true } }] }))
        .toContain('exactly one of trailing, toDate or cumulative');
      expect(refusal({ calculations: [{ name: '1x', rank: { measure: 'revenue' } }] })).toContain('calculations.0.name');
    });

    it('keeps field names exact inside calculations', () => {
      // A filter calculation conditions on local, non-time fields only.
      expect(refusal({ calculations: [{ name: 'x', filter: { measure: 'revenue', where: [{ field: 'createdAt', operator: 'gt', value: '2026-01-01' }] } }] }))
        .toContain('calculations.0.filter.where.0.field: Invalid option: expected one of "amount"|"channel"|"country"|"status"');
      expect(refusal({ calculations: [{ name: 'x', rank: { measure: 'revenue', within: ['region'] } }] })).toContain('calculations.0.rank.within.0');
      expect(refusal({ limitBy: { n: 2, by: ['region'] } })).toContain('limitBy.by.0');
      expect(refusal({ other: { dimension: 'amount', n: 3, measure: 'revenue' } })).toContain('other.dimension');
      expect(refusal({ other: { dimension: 'country', n: 1001, measure: 'revenue' } })).toContain('other.n');
    });

    it('orders by and filters on calculation outputs, and only on outputs the call names', () => {
      const vs = [{ name: 'vs', compare: { to: 'previousPeriod', measures: ['revenue'] } }];
      expect(() => parse({
        calculations: vs, grain: 'month',
        orderBy: [{ field: 'revenue_change_pct', direction: 'desc' }],
        having: [{ measure: 'revenue_previous', operator: 'gt', value: 0 }],
      })).not.toThrow();
      expect(refusal({ orderBy: [{ field: 'revenue_change_pct', direction: 'desc' }] })).toContain('orderBy.0.field');
      expect(refusal({ having: [{ measure: 'nope', operator: 'gt', value: 0 }] })).toContain('having.0.measure');
      expect(refusal({ orderBy: [{ field: 'nope', direction: 'desc' }] })).not.toContain('nope');
    });

    it('counts comparisons inside groups against the host filter budget, for both tools', async () => {
      const totalRevenue = Orders.metric('totalRevenue', { measure: 'revenue' });
      const { db, sql } = recording();
      const executor = new HypequeryMCPExecutor({
        datasets: { orders: { ...Orders, metrics: { totalRevenue } } },
        analytics: createDatasetClient({ queryBuilder: db, now: () => NOW }),
        queryLimits: { maxFilters: 2 },
      });
      const three = { or: [
        { field: 'country', operator: 'eq', value: 'US' },
        { field: 'country', operator: 'eq', value: 'CA' },
        { not: { field: 'status', operator: 'eq', value: 'refunded' } },
      ] };
      const dataset = errorOf(await executor.callTool('query_dataset', { dataset: 'orders', measures: ['revenue'], filters: [three] }));
      expect(dataset).toMatchObject({ code: 'MCP_INVALID_ARGUMENTS', message: 'Invalid filters: 3 comparisons, maximum 2' });
      const metric = errorOf(await executor.callTool('query_metric', { dataset: 'orders', metric: 'totalRevenue', filters: [three] }));
      expect(metric.code).toBe('MCP_INVALID_ARGUMENTS');
      // With calculations, having and filter-calculation conditions share the budget.
      const calculated = errorOf(await executor.callTool('query_dataset', {
        dataset: 'orders', measures: ['revenue'],
        filters: [{ field: 'country', operator: 'eq', value: 'US' }],
        calculations: [{ name: 'web', filter: { measure: 'revenue', where: [{ field: 'channel', operator: 'eq', value: 'web' }] } }],
        having: [{ measure: 'web', operator: 'gt', value: 0 }],
      }));
      expect(calculated.message).toBe('Invalid filters: 3 comparisons, maximum 2 (filters, having and filter-calculation conditions combined)');
      expect(sql).toHaveLength(0);
      const within = await executor.callTool('query_dataset', { dataset: 'orders', measures: ['revenue'], filters: [{ or: three.or.slice(0, 2) }] });
      expect(within.isError).toBeFalsy();
    });

    it('bounds nesting before parsing', () => {
      let deep: Record<string, unknown> = { field: 'country', operator: 'eq', value: 'US' };
      for (let level = 0; level < 100; level += 1) deep = { not: deep };
      expect(refusal({ filters: [deep] })).toContain('nested too deeply');
    });
  });

  describe('round trip', () => {
    const args = {
      dataset: 'orders',
      dimensions: ['country'],
      measures: ['revenue', 'orders'],
      filters: [US_OR_CA, NOT_REFUNDED, LAST_30_DAYS],
      calculations: [
        { name: 'web_revenue', filter: { measure: 'revenue', where: [{ field: 'channel', operator: 'eq', value: 'web' }] } },
        { name: 'aov', formula: { op: 'round', args: [{ op: 'divide', args: ['revenue', { op: 'nullIfZero', args: ['orders'] }] }, 2] } },
        { name: 'revenue_rank', rank: { measure: 'revenue' } },
      ],
      orderBy: [{ field: 'revenue_rank', direction: 'asc' }],
      limit: 10,
    };
    const rows = [{ country: 'US', revenue: '120', orders: '4', web_revenue: '80', aov: '30', revenue_rank: '1' }];
    const columns = [
      { name: 'web_revenue', kind: 'filter', calculation: 'web_revenue', measure: 'revenue', type: 'number' },
      { name: 'aov', kind: 'formula', calculation: 'aov', type: 'number' },
      { name: 'revenue_rank', kind: 'rank', calculation: 'revenue_rank', measure: 'revenue', type: 'integer' },
    ];

    it('runs through the local executor with groups, a resolved range and calculation metadata', async () => {
      const { executor, sql } = localExecutor(rows);
      const result = await executor.callTool('query_dataset', args);
      expect(result.isError).toBeFalsy();
      const content = result.structuredContent as { data: unknown[]; meta: { calculations?: unknown } };
      expect(content.data).toEqual(rows);
      expect(content.meta.calculations).toEqual(columns);
      expect(sql).toHaveLength(1);
      // `or` stays an OR, `not` a negation, and the range is resolved by the server's clock.
      expect(sql[0]).toContain('(orders.country = ? OR orders.country = ?)');
      expect(sql[0]).toMatch(/NOT \(orders\.status = \?\)|orders\.status != \?|NOT orders\.status = \?/);
      expect(sql[0]).toContain('rank()');
      expect(sql[0]).toContain('"2026-10-23","2026-11-22"');
    });

    it('turns the same arguments into a protocol operation the data plane validates and runs', async () => {
      const parsed = parseToolArgs(buildMCPQuerySchemas({ orders: Orders }).queryDataset, 'query_dataset', args);
      const { dataset: name, ...rest } = parsed;
      const operation = validateProtocolSemanticQuery(
        toProtocolDatasetQuery(name, datasetQueryFromArgs(rest, { limit: rest.limit })),
        { extension: 2 },
      );
      expect(operation).toMatchObject({
        kind: 'dataset', dataset: 'orders', limit: 10,
        filters: [
          { kind: 'logical', operator: 'or' },
          { kind: 'logical', operator: 'not' },
          { kind: 'comparison', operator: 'inDateRange', right: { kind: 'literal', value: 'last 30 days' } },
        ],
        calculations: [{ name: 'web_revenue', filter: { where: [{ kind: 'comparison', operator: 'eq' }] } }, { name: 'aov' }, { name: 'revenue_rank' }],
      });

      const deployment = buildProtocolDeploymentContract([Orders]);
      const { db, sql } = recording(rows);
      const result = await createPortableSemanticRuntime({ queryBuilder: db }).execute({
        deployment,
        dataset: deployment.datasets[0],
        operation,
        tenant: undefined,
        budget: { maxRows: 100 },
        activationRevision: 'a'.repeat(64),
      });
      expect(result.meta.calculations).toEqual(columns);
      expect(sql).toHaveLength(1);
      expect(sql[0]).toContain('rank()');
    });

    it('carries fill and timeKey to the client, bucketing on the selected axis', async () => {
      const { executor, sql } = localExecutor();
      const result = await executor.callTool('query_dataset', {
        dataset: 'orders', measures: ['orders'], grain: 'week', timeKey: 'shippedAt', fill: true,
        filters: [{ field: 'shippedAt', operator: 'inDateRange', value: 'this quarter' }],
      });
      expect(result.isError).toBeFalsy();
      expect(sql[0]).toContain('shipped_at');
      expect(sql[0]).not.toMatch(/toStartOfWeek\(`?created_at/);
      expect(sql[0]).toContain('"2026-10-01","2027-01-01"');
    });

    it('carries limitBy and other to the client', async () => {
      const { executor, sql } = localExecutor();
      const result = await executor.callTool('query_dataset', {
        dataset: 'orders', dimensions: ['country', 'channel'], measures: ['revenue'],
        orderBy: [{ field: 'revenue', direction: 'desc' }],
        limitBy: { n: 2, by: ['channel'] },
        other: { dimension: 'country', n: 5, measure: 'revenue', label: 'Rest' },
      });
      expect(result.isError).toBeFalsy();
      expect(sql[0]).toContain('LIMIT 2 BY');
      expect(sql[0]).toContain('_hq_other_top');
    });

    it('returns a correctable error, never a silent drop, when the client refuses a combination', async () => {
      const { executor, sql } = localExecutor();
      // fill needs a bounded time range; the schema cannot know the filters lack one.
      const error = errorOf(await executor.callTool('query_dataset', { dataset: 'orders', measures: ['orders'], grain: 'day', fill: true }));
      expect(error.code).toBe('MCP_INVALID_ARGUMENTS');
      expect(sql).toHaveLength(0);
    });
  });

  describe('query_metric', () => {
    it('carries filter groups, a relative range and timeKey to a metric query', async () => {
      const totalRevenue = Orders.metric('totalRevenue', { measure: 'revenue' });
      const { db, sql } = recording();
      const executor = new HypequeryMCPExecutor({
        datasets: { orders: { ...Orders, metrics: { totalRevenue } } },
        analytics: createDatasetClient({ queryBuilder: db, now: () => NOW }),
      });
      const result = await executor.callTool('query_metric', {
        dataset: 'orders', metric: 'totalRevenue', grain: 'month', timeKey: 'shippedAt',
        filters: [US_OR_CA, { field: 'shippedAt', operator: 'inDateRange', value: 'this year' }],
      });
      expect(result.isError).toBeFalsy();
      expect(sql[0]).toContain('(orders.country = ? OR orders.country = ?)');
      expect(sql[0]).toContain('shipped_at');
      expect(sql[0]).toContain('"2026-01-01","2027-01-01"');
      const refused = errorOf(await executor.callTool('query_metric', {
        dataset: 'orders', metric: 'totalRevenue', fill: true,
      }));
      expect(refused.code).toBe('MCP_INVALID_ARGUMENTS');
    });
  });
});
