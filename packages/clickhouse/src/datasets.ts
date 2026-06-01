import {
  createExecutor,
  type MetricFilter,
  type PlanNode,
  type SemanticBackend,
  type SemanticBackendResult,
  type SemanticExecutor,
  type SemanticExpression,
} from '@hypequery/datasets';
export {
  add,
  asc,
  avg,
  belongsTo,
  between,
  ceil,
  coalesce,
  count,
  countDistinct,
  dataset,
  desc,
  dimension,
  divide,
  eq,
  filter,
  floor,
  gt,
  gte,
  hasMany,
  hasOne,
  inList,
  like,
  lt,
  lte,
  max,
  measure,
  min,
  multiply,
  neq,
  notInList,
  nullIfZero,
  order,
  round,
  subtract,
  sum,
} from '@hypequery/datasets';
export type {
  DatasetInstance,
  DatasetQuery,
  DatasetQueryResult,
  MetricQuery,
  MetricResult,
} from '@hypequery/datasets';
import { createQueryBuilder } from './core/query-builder.js';
import type { CreateQueryBuilderConfig } from './core/query-builder.js';
import type { SchemaDefinition } from './core/types/builder-state.js';

export type ClickHouseDatasetClient = SemanticExecutor;
export type CreateDatasetClientConfig = CreateQueryBuilderConfig;

const GRAIN_FUNCTIONS = {
  day: 'toStartOfDay',
  week: 'toStartOfWeek',
  month: 'toStartOfMonth',
  quarter: 'toStartOfQuarter',
  year: 'toStartOfYear',
} as const;

function renderGrain(field: string, unit: keyof typeof GRAIN_FUNCTIONS): string {
  return `${GRAIN_FUNCTIONS[unit]}(${field})`;
}

function applyFilters(builder: any, filters: MetricFilter[]): any {
  let qb = builder;
  for (const filter of filters) {
    qb = qb.where(filter.field, filter.operator, filter.value);
  }
  return qb;
}

function renderLiteral(value: string | number | boolean | null): string {
  if (value === null) return 'NULL';
  if (typeof value === 'number') return String(value);
  if (typeof value === 'boolean') return value ? '1' : '0';
  return `'${value.replace(/'/g, "''")}'`;
}

function renderFilterCondition(filter: MetricFilter): string {
  switch (filter.operator) {
    case 'eq':
      return `${filter.field} = ${renderLiteral(filter.value as any)}`;
    case 'neq':
      return `${filter.field} != ${renderLiteral(filter.value as any)}`;
    case 'gt':
      return `${filter.field} > ${renderLiteral(filter.value as any)}`;
    case 'gte':
      return `${filter.field} >= ${renderLiteral(filter.value as any)}`;
    case 'lt':
      return `${filter.field} < ${renderLiteral(filter.value as any)}`;
    case 'lte':
      return `${filter.field} <= ${renderLiteral(filter.value as any)}`;
    case 'like':
      return `${filter.field} LIKE ${renderLiteral(filter.value as any)}`;
    case 'in':
    case 'notIn': {
      if (!Array.isArray(filter.value) || filter.value.length === 0) {
        throw new Error(`"${filter.operator}" filters require a non-empty array.`);
      }
      const values = filter.value.map((value) => renderLiteral(value as any)).join(', ');
      return `${filter.field} ${filter.operator === 'in' ? 'IN' : 'NOT IN'} (${values})`;
    }
    case 'between': {
      if (!Array.isArray(filter.value) || filter.value.length !== 2) {
        throw new Error('"between" filters require a two-item array.');
      }
      return `${filter.field} BETWEEN ${renderLiteral(filter.value[0] as any)} AND ${renderLiteral(filter.value[1] as any)}`;
    }
    default:
      throw new Error(`Unsupported filter operator "${filter.operator}".`);
  }
}

function renderFilteredAggregationField(
  aggregation: Extract<PlanNode, { kind: 'aggregate' }>['aggregations'][number],
): string {
  if (!aggregation.filters?.length) {
    return aggregation.field;
  }

  const condition = aggregation.filters
    .map(renderFilterCondition)
    .map((part) => `(${part})`)
    .join(' AND ');
  const fallback = aggregation.aggregation === 'sum' ? '0' : 'NULL';
  return `if(${condition}, ${aggregation.field}, ${fallback})`;
}

function renderExpression(expression: SemanticExpression): string {
  switch (expression.kind) {
    case 'ref':
      return expression.name;
    case 'literal':
      return renderLiteral(expression.value);
    case 'binary': {
      const operator = {
        add: '+',
        subtract: '-',
        multiply: '*',
        divide: '/',
      }[expression.operator];
      return `(${renderExpression(expression.left)}) ${operator} (${renderExpression(expression.right)})`;
    }
    case 'function': {
      if (expression.name === 'nullIfZero') {
        return `NULLIF(${renderExpression(expression.args[0])}, 0)`;
      }
      if (expression.name === 'coalesce') {
        return `COALESCE(${expression.args.map(renderExpression).join(', ')})`;
      }
      const fn = {
        round: 'ROUND',
        floor: 'FLOOR',
        ceil: 'CEIL',
      }[expression.name];
      return `${fn}(${expression.args.map(renderExpression).join(', ')})`;
    }
    default:
      throw new Error('Unsupported semantic expression.');
  }
}

function applyAggregations(builder: any, plan: Extract<PlanNode, { kind: 'aggregate' }>): any {
  let qb = builder;
  for (const aggregation of plan.aggregations) {
    const field = renderFilteredAggregationField(aggregation);
    switch (aggregation.aggregation) {
      case 'sum':
        qb = qb.sum(field, aggregation.name);
        break;
      case 'count':
        qb = qb.count(field, aggregation.name);
        break;
      case 'countDistinct':
        qb = qb.countDistinct(field, aggregation.name);
        break;
      case 'avg':
        qb = qb.avg(field, aggregation.name);
        break;
      case 'min':
        qb = qb.min(field, aggregation.name);
        break;
      case 'max':
        qb = qb.max(field, aggregation.name);
        break;
    }
  }
  return qb;
}

function appendOrderLimitOffset(builder: any, plan: Pick<PlanNode, 'orderBy' | 'limit' | 'offset'>): any {
  let qb = builder;
  for (const order of plan.orderBy ?? []) {
    qb = qb.orderBy(order.field, order.direction.toUpperCase());
  }
  if (plan.limit != null) qb = qb.limit(plan.limit);
  if (plan.offset != null) qb = qb.offset(plan.offset);
  return qb;
}

function buildAggregateQuery(queryBuilder: any, plan: Extract<PlanNode, { kind: 'aggregate' }>): any {
  let qb = queryBuilder.table(plan.source);
  const selectParts = plan.dimensions.map((dimension) => (
    dimension.field === dimension.name ? dimension.name : `${dimension.field} AS ${dimension.name}`
  ));
  const groupByParts = plan.dimensions.map((dimension) => dimension.name);

  if (plan.grain) {
    selectParts.unshift(`${renderGrain(plan.grain.field, plan.grain.unit)} AS ${plan.grain.output}`);
    groupByParts.unshift(plan.grain.output);
  }

  if (selectParts.length > 0) qb = qb.select(selectParts);
  qb = applyAggregations(qb, plan);
  if (groupByParts.length > 0) qb = qb.groupBy(groupByParts);
  if (plan.tenant) qb = qb.where(plan.tenant.field, 'eq', plan.tenant.value);
  qb = applyFilters(qb, plan.filters);
  return appendOrderLimitOffset(qb, plan);
}

function buildDerivedSQL(queryBuilder: any, plan: Extract<PlanNode, { kind: 'derive' }>) {
  if (plan.input.kind !== 'aggregate') {
    throw new Error('ClickHouse datasets currently supports derived metrics over aggregate input plans only.');
  }

  const inputQuery = buildAggregateQuery(queryBuilder, plan.input);
  const { sql, parameters } = inputQuery.toSQLWithParams();
  const passthrough = [
    ...(plan.input.grain ? [plan.input.grain.output] : []),
    ...plan.input.dimensions.map((dimension) => dimension.name),
  ];
  const metricSelects = plan.metrics.map((metric) => (
    `${renderExpression(metric.expression)} AS ${metric.name}`
  ));
  let outerSql = `WITH base AS (${sql}) SELECT ${[...passthrough, ...metricSelects].join(', ')} FROM base`;

  if (plan.orderBy?.length) {
    outerSql += ` ORDER BY ${plan.orderBy.map((order) => (
      `${order.field} ${order.direction.toUpperCase()}`
    )).join(', ')}`;
  }
  if (plan.limit != null) outerSql += ` LIMIT ${plan.limit}`;
  if (plan.offset != null) outerSql += ` OFFSET ${plan.offset}`;

  return { sql: outerSql, parameters };
}

export function createClickHouseSemanticBackend<Schema extends SchemaDefinition<Schema>>(
  config: CreateDatasetClientConfig,
): SemanticBackend {
  const queryBuilder = createQueryBuilder<Schema>(config);

  return {
    async execute<T = Record<string, unknown>>(plan: PlanNode): Promise<SemanticBackendResult<T>> {
      const start = Date.now();
      if (plan.kind === 'aggregate') {
        const query = buildAggregateQuery(queryBuilder, plan);
        const { sql } = query.toSQLWithParams();
        const data = await query.execute() as T[];
        return { data, meta: { sql, timingMs: Date.now() - start, tenant: plan.tenant?.value } };
      }

      const { sql, parameters } = buildDerivedSQL(queryBuilder, plan);
      const data = await queryBuilder.rawQuery<T>(sql, parameters);
      const tenant = plan.input.kind === 'aggregate' ? plan.input.tenant?.value : undefined;
      return { data, meta: { sql, timingMs: Date.now() - start, tenant } };
    },
    async explain(plan: PlanNode) {
      if (plan.kind === 'aggregate') {
        return { sql: buildAggregateQuery(queryBuilder, plan).toSQLWithParams().sql };
      }
      return { sql: buildDerivedSQL(queryBuilder, plan).sql };
    },
  };
}

export function createDatasetClient<Schema extends SchemaDefinition<Schema>>(
  config: CreateDatasetClientConfig,
): ClickHouseDatasetClient {
  return createExecutor({
    backend: createClickHouseSemanticBackend<Schema>(config),
  });
}
