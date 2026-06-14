/**
 * ClickHouse Semantic Backend
 *
 * This module implements the SemanticBackend interface from @hypequery/datasets
 * for ClickHouse databases. It translates database-agnostic semantic plans
 * (PlanNode) into ClickHouse-specific SQL and executes them.
 *
 * Architecture:
 * - @hypequery/datasets: Owns semantic planning, validation, and execution protocol
 * - @hypequery/clickhouse: Implements SQL translation and execution for ClickHouse
 *
 * Usage:
 * ```ts
 * import { createDatasetClient } from '@hypequery/datasets';
 * import { createBackend } from '@hypequery/clickhouse/datasets';
 *
 * const analytics = createDatasetClient({
 *   backend: createBackend({
 *     url: process.env.CLICKHOUSE_URL,
 *     username: process.env.CLICKHOUSE_USER,
 *     password: process.env.CLICKHOUSE_PASSWORD,
 *     database: process.env.CLICKHOUSE_DATABASE,
 *   })
 * });
 * ```
 */

import {
  type MetricFilter,
  type PlanNode,
  type SemanticBackend,
  type SemanticBackendResult,
  type SemanticExpression,
} from '@hypequery/datasets';
import { createQueryBuilder } from './core/query-builder.js';
import type { CreateQueryBuilderConfig } from './core/query-builder.js';
import type { SchemaDefinition } from './core/types/builder-state.js';

export type CreateBackendConfig = CreateQueryBuilderConfig;

// =============================================================================
// ClickHouse SQL Generation Utilities
// =============================================================================

const GRAIN_FUNCTIONS = {
  day: 'toStartOfDay',
  week: 'toStartOfWeek',
  month: 'toStartOfMonth',
  quarter: 'toStartOfQuarter',
  year: 'toStartOfYear',
} as const;

/**
 * SQL Literal Rendering
 * Safely escapes values for direct SQL inclusion
 */
function renderLiteral(value: string | number | boolean | null): string {
  if (value === null) return 'NULL';
  if (typeof value === 'number') return String(value);
  if (typeof value === 'boolean') return value ? '1' : '0';
  // SQL string escaping: single quotes are escaped by doubling them
  return `'${String(value).replace(/'/g, "''")}'`;
}

/**
 * Time Grain Rendering
 * Converts semantic grain to ClickHouse function
 */
function renderGrain(field: string, unit: keyof typeof GRAIN_FUNCTIONS): string {
  return `${GRAIN_FUNCTIONS[unit]}(${field})`;
}

/**
 * Filter Rendering - Applies filters using query builder WHERE clauses
 * This is the preferred method when working with the query builder
 */
function applyFilters(builder: any, filters: MetricFilter[]): any {
  let qb = builder;
  for (const filter of filters) {
    qb = qb.where(filter.field, filter.operator, filter.value);
  }
  return qb;
}

/**
 * Type guard to check if value is a valid literal for SQL rendering
 */
function isLiteralValue(value: unknown): value is string | number | boolean | null {
  return (
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean' ||
    value === null
  );
}

/**
 * Safely render a filter value as a SQL literal
 * Throws if value is not a valid literal type
 */
function renderFilterValue(value: unknown): string {
  if (!isLiteralValue(value)) {
    throw new Error(`Invalid filter value type: ${typeof value}`);
  }
  return renderLiteral(value);
}

/**
 * Filter Condition Rendering - Converts filter to SQL WHERE clause string
 * Used for filtered aggregations (IF conditions) where query builder can't be used
 */
function renderFilterCondition(filter: MetricFilter): string {
  const { field, operator, value } = filter;

  switch (operator) {
    case 'eq':
      return `${field} = ${renderFilterValue(value)}`;
    case 'neq':
      return `${field} != ${renderFilterValue(value)}`;
    case 'gt':
      return `${field} > ${renderFilterValue(value)}`;
    case 'gte':
      return `${field} >= ${renderFilterValue(value)}`;
    case 'lt':
      return `${field} < ${renderFilterValue(value)}`;
    case 'lte':
      return `${field} <= ${renderFilterValue(value)}`;
    case 'like':
      return `${field} LIKE ${renderFilterValue(value)}`;
    case 'in':
    case 'notIn': {
      if (!Array.isArray(value) || value.length === 0) {
        throw new Error(`"${operator}" filters require a non-empty array.`);
      }
      const values = value.map(renderFilterValue).join(', ');
      const op = operator === 'in' ? 'IN' : 'NOT IN';
      return `${field} ${op} (${values})`;
    }
    case 'between': {
      if (!Array.isArray(value) || value.length !== 2) {
        throw new Error('"between" filters require a two-item array.');
      }
      return `${field} BETWEEN ${renderFilterValue(value[0])} AND ${renderFilterValue(value[1])}`;
    }
    default:
      throw new Error(`Unsupported filter operator "${operator}".`);
  }
}

/**
 * Filtered Aggregation Field Rendering
 * Generates ClickHouse IF() expressions for conditional aggregations
 * Example: SUM(if(status = 'completed', amount, 0))
 */
function renderFilteredAggregationField(
  aggregation: Extract<PlanNode, { kind: 'aggregate' }>['aggregations'][number],
): string {
  if (!aggregation.filters?.length) {
    return aggregation.field;
  }

  // Combine multiple filters with AND
  const condition = aggregation.filters
    .map(renderFilterCondition)
    .map((part) => `(${part})`)
    .join(' AND ');

  // Use appropriate fallback: 0 for SUM, NULL for others
  const fallback = aggregation.aggregation === 'sum' ? '0' : 'NULL';

  return `if(${condition}, ${aggregation.field}, ${fallback})`;
}

/**
 * Expression Rendering
 * Converts semantic expressions (formulas) to SQL
 * Used for derived metrics
 */
function renderExpression(expression: SemanticExpression): string {
  switch (expression.kind) {
    case 'ref':
      return expression.name;

    case 'literal':
      return renderLiteral(expression.value);

    case 'binary': {
      const operators = {
        add: '+',
        subtract: '-',
        multiply: '*',
        divide: '/',
      };
      const op = operators[expression.operator];
      const left = renderExpression(expression.left);
      const right = renderExpression(expression.right);
      return `(${left}) ${op} (${right})`;
    }

    case 'function': {
      const args = expression.args.map(renderExpression);

      // Special case functions with custom SQL
      if (expression.name === 'nullIfZero') {
        return `NULLIF(${args[0]}, 0)`;
      }
      if (expression.name === 'coalesce') {
        return `COALESCE(${args.join(', ')})`;
      }

      // Standard functions
      const functionMap: Record<string, string> = {
        round: 'ROUND',
        floor: 'FLOOR',
        ceil: 'CEIL',
      };
      const fn = functionMap[expression.name];
      if (!fn) {
        throw new Error(`Unsupported function: ${expression.name}`);
      }
      return `${fn}(${args.join(', ')})`;
    }

    default:
      throw new Error('Unsupported semantic expression.');
  }
}

// =============================================================================
// Query Builder Integration
// =============================================================================

/**
 * Apply Aggregations
 * Translates semantic aggregations to query builder method calls
 */
function applyAggregations(builder: any, plan: Extract<PlanNode, { kind: 'aggregate' }>): any {
  let qb = builder;

  for (const aggregation of plan.aggregations) {
    const field = renderFilteredAggregationField(aggregation);
    const { name, aggregation: aggType } = aggregation;

    switch (aggType) {
      case 'sum':
        qb = qb.sum(field, name);
        break;
      case 'count':
        qb = qb.count(field, name);
        break;
      case 'countDistinct':
        qb = qb.countDistinct(field, name);
        break;
      case 'avg':
        qb = qb.avg(field, name);
        break;
      case 'min':
        qb = qb.min(field, name);
        break;
      case 'max':
        qb = qb.max(field, name);
        break;
    }
  }

  return qb;
}

/**
 * Append Order/Limit/Offset
 * Applies result modifiers to query builder
 */
function appendOrderLimitOffset(builder: any, plan: Pick<PlanNode, 'orderBy' | 'limit' | 'offset'>): any {
  let qb = builder;

  // Order by
  for (const order of plan.orderBy ?? []) {
    qb = qb.orderBy(order.field, order.direction.toUpperCase());
  }

  // Pagination
  if (plan.limit != null) qb = qb.limit(plan.limit);
  if (plan.offset != null) qb = qb.offset(plan.offset);

  return qb;
}

// =============================================================================
// Plan Translation to SQL
// =============================================================================

/**
 * Build Aggregate Query
 * Translates semantic aggregate plan to ClickHouse query builder
 */
function buildAggregateQuery(queryBuilder: any, plan: Extract<PlanNode, { kind: 'aggregate' }>): any {
  let qb = queryBuilder.table(plan.source);

  // Build SELECT and GROUP BY for dimensions
  const selectParts: string[] = [];
  const groupByParts: string[] = [];

  // Time grain (period column)
  if (plan.grain) {
    const grainSql = renderGrain(plan.grain.field, plan.grain.unit);
    selectParts.push(`${grainSql} AS ${plan.grain.output}`);
    groupByParts.push(plan.grain.output);
  }

  // Dimensions
  for (const dimension of plan.dimensions) {
    const columnSql = dimension.field === dimension.name
      ? dimension.name
      : `${dimension.field} AS ${dimension.name}`;
    selectParts.push(columnSql);
    groupByParts.push(dimension.name);
  }

  // Apply SELECT clause
  if (selectParts.length > 0) {
    qb = qb.select(selectParts);
  }

  // Apply aggregations (measures)
  qb = applyAggregations(qb, plan);

  // Apply GROUP BY
  if (groupByParts.length > 0) {
    qb = qb.groupBy(groupByParts);
  }

  // Apply tenant filter (auto-injected)
  if (plan.tenant) {
    qb = qb.where(plan.tenant.field, plan.tenant.operator, plan.tenant.value);
  }

  // Apply user filters
  qb = applyFilters(qb, plan.filters);

  // Apply order/limit/offset
  return appendOrderLimitOffset(qb, plan);
}

/**
 * Build Derived Metric SQL
 * Generates CTE-based query for derived metrics (formulas over base metrics)
 *
 * Note: Uses string concatenation for outer query since query builder
 * doesn't support CTEs natively. Inner query uses query builder for safety.
 */
function buildDerivedSQL(queryBuilder: any, plan: Extract<PlanNode, { kind: 'derive' }>) {
  if (plan.input.kind !== 'aggregate') {
    throw new Error('ClickHouse datasets currently supports derived metrics over aggregate input plans only.');
  }

  // Build inner aggregate query using query builder
  const inputQuery = buildAggregateQuery(queryBuilder, plan.input);
  const { sql, parameters } = inputQuery.toSQLWithParams();

  // Passthrough columns (grain + dimensions)
  const passthrough = [
    ...(plan.input.grain ? [plan.input.grain.output] : []),
    ...plan.input.dimensions.map((dim) => dim.name),
  ];

  // Derived metric calculations
  const metricSelects = plan.metrics.map((metric) =>
    `${renderExpression(metric.expression)} AS ${metric.name}`
  );

  // Build outer query with CTE
  const allSelects = [...passthrough, ...metricSelects];
  let outerSql = `WITH base AS (${sql}) SELECT ${allSelects.join(', ')} FROM base`;

  // ORDER BY
  if (plan.orderBy?.length) {
    const orderClauses = plan.orderBy.map(
      (order) => `${order.field} ${order.direction.toUpperCase()}`
    );
    outerSql += ` ORDER BY ${orderClauses.join(', ')}`;
  }

  // LIMIT and OFFSET
  if (plan.limit != null) {
    outerSql += ` LIMIT ${plan.limit}`;
  }
  if (plan.offset != null) {
    outerSql += ` OFFSET ${plan.offset}`;
  }

  return { sql: outerSql, parameters };
}

// =============================================================================
// Semantic Backend Implementation
// =============================================================================

/**
 * Create ClickHouse Semantic Backend
 *
 * Creates a SemanticBackend implementation that translates database-agnostic
 * semantic plans into ClickHouse SQL and executes them.
 *
 * @param config - ClickHouse connection configuration
 * @returns SemanticBackend interface for executing semantic queries
 */
export function createBackend<Schema extends SchemaDefinition<Schema>>(
  config: CreateBackendConfig,
): SemanticBackend {
  const queryBuilder = createQueryBuilder<Schema>(config);

  return {
    /**
     * Execute a semantic plan and return results
     */
    async execute<T = Record<string, unknown>>(plan: PlanNode): Promise<SemanticBackendResult<T>> {
      const start = Date.now();

      if (plan.kind === 'aggregate') {
        // Base metrics: use query builder for full safety
        const query = buildAggregateQuery(queryBuilder, plan);
        const { sql } = query.toSQLWithParams();
        const data = await query.execute() as T[];

        return {
          data,
          meta: {
            sql,
            timingMs: Date.now() - start,
            tenant: plan.tenant?.operator === 'eq' ? plan.tenant.value : undefined,
          },
        };
      }

      // Derived metrics: CTE query with formulas
      const { sql, parameters } = buildDerivedSQL(queryBuilder, plan);
      const data = await queryBuilder.rawQuery<T>(sql, parameters);
      const tenant = plan.input.kind === 'aggregate' && plan.input.tenant?.operator === 'eq'
        ? plan.input.tenant.value
        : undefined;

      return {
        data,
        meta: {
          sql,
          timingMs: Date.now() - start,
          tenant,
        },
      };
    },

    /**
     * Generate SQL without executing
     */
    async explain(plan: PlanNode) {
      if (plan.kind === 'aggregate') {
        return { sql: buildAggregateQuery(queryBuilder, plan).toSQLWithParams().sql };
      }
      return { sql: buildDerivedSQL(queryBuilder, plan).sql };
    },
  };
}
