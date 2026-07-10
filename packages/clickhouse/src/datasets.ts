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
 * Usage (recommended): pass the query builder you already use for
 * hand-written queries, so semantic and ad hoc queries share one connection.
 * ```ts
 * import { createDatasetClient } from '@hypequery/datasets';
 * import { createQueryBuilder } from '@hypequery/clickhouse';
 *
 * const db = createQueryBuilder({
 *   url: process.env.CLICKHOUSE_URL,
 *   username: process.env.CLICKHOUSE_USER,
 *   password: process.env.CLICKHOUSE_PASSWORD,
 *   database: process.env.CLICKHOUSE_DATABASE,
 * });
 *
 * const analytics = createDatasetClient({ queryBuilder: db });
 * ```
 *
 * Deprecated: `createBackend` exposes the database-agnostic SemanticBackend
 * protocol directly. That plan/backend path is FROZEN — it receives bug fixes
 * only, and new semantic features are not guaranteed to be mirrored there.
 * Use the query-builder path above instead.
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

/** @deprecated The plan/backend path is frozen; use `createQueryBuilder` with `createDatasetClient({ queryBuilder })`. */
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
  // SQL string escaping: backslashes first (ClickHouse treats `\` as an escape
  // inside string literals), then single quotes doubled.
  return `'${String(value).replace(/\\/g, '\\\\').replace(/'/g, "''")}'`;
}

/**
 * Time Grain Rendering
 * Converts semantic grain to ClickHouse function
 */
function renderGrain(field: string, unit: keyof typeof GRAIN_FUNCTIONS): string {
  return `${GRAIN_FUNCTIONS[unit]}(${field})`;
}

/**
 * Backtick-quotes a ClickHouse identifier, doubling any embedded backticks.
 */
function quoteIdentifier(identifier: string): string {
  return `\`${identifier.replace(/`/g, '``')}\``;
}

/**
 * Quotes a name only when it is relationship-qualified (contains a dot), so
 * joined column aliases like `customer.country` render as `` `customer.country` ``.
 */
function quoteQualified(name: string): string {
  return name.includes('.') ? quoteIdentifier(name) : name;
}

/** Maps a plan field to its SQL reference. See {@link makeColumnQualifier}. */
type ColumnQualifier = (field: string) => string;

/**
 * Builds a column qualifier for an aggregate plan. When the plan has joins,
 * base columns are table-qualified with the plan source (`orders.status`) while
 * columns already qualified by a relationship alias (`customer.country`) are
 * left untouched. Without joins the field passes through unchanged so non-join
 * SQL is byte-for-byte identical.
 */
function makeColumnQualifier(plan: Extract<PlanNode, { kind: 'aggregate' }>): ColumnQualifier {
  const joins = plan.joins ?? [];
  if (joins.length === 0) {
    return (field) => field;
  }
  const relationships = new Set(joins.map((join) => join.relationship));
  return (field) => {
    const dot = field.indexOf('.');
    if (dot !== -1 && relationships.has(field.slice(0, dot))) {
      return field;
    }
    return `${plan.source}.${field}`;
  };
}

/**
 * Filter Rendering - Applies filters using query builder WHERE clauses
 * This is the preferred method when working with the query builder
 */
function applyFilters(builder: any, filters: MetricFilter[], qualify: ColumnQualifier = (field) => field): any {
  let qb = builder;
  for (const filter of filters) {
    qb = qb.where(qualify(filter.field), filter.operator, filter.value);
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
function renderFilterCondition(filter: MetricFilter, qualify: ColumnQualifier = (field) => field): string {
  const { operator, value } = filter;
  const field = qualify(filter.field);

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
  qualify: ColumnQualifier = (field) => field,
): string {
  const field = qualify(aggregation.field);
  if (!aggregation.filters?.length) {
    return field;
  }

  // Combine multiple filters with AND
  const condition = aggregation.filters
    .map((filter) => renderFilterCondition(filter, qualify))
    .map((part) => `(${part})`)
    .join(' AND ');

  // Use appropriate fallback: 0 for SUM, NULL for others
  const fallback = aggregation.aggregation === 'sum' ? '0' : 'NULL';

  return `if(${condition}, ${field}, ${fallback})`;
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
function applyAggregations(
  builder: any,
  plan: Extract<PlanNode, { kind: 'aggregate' }>,
  qualify: ColumnQualifier = (field) => field,
): any {
  let qb = builder;

  for (const aggregation of plan.aggregations) {
    const field = renderFilteredAggregationField(aggregation, qualify);
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

  // Order by (qualified fields reference their quoted joined alias)
  for (const order of plan.orderBy ?? []) {
    qb = qb.orderBy(quoteQualified(order.field), order.direction.toUpperCase());
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
  const qualify = makeColumnQualifier(plan);
  const hasJoins = (plan.joins?.length ?? 0) > 0;

  // Relationship LEFT ANY JOINs (to-one). Base rows survive and at most one
  // target row matches, so duplicate join keys can never fan out aggregates —
  // matching the in-memory backend's first-match semantics. Joined columns are
  // addressable as `<relationship>.<column>`.
  for (const join of plan.joins ?? []) {
    qb = qb.leftAnyJoin(
      join.source,
      `${plan.source}.${join.from}`,
      `${join.source}.${join.to}`,
      join.relationship,
      join.tenant
        ? {
          column: `${join.relationship}.${join.tenant.field}`,
          operator: join.tenant.operator,
          value: join.tenant.value,
        }
        : undefined,
    );
  }

  // Build SELECT and GROUP BY for dimensions
  const selectParts: string[] = [];
  const groupByParts: string[] = [];

  // Time grain (period column)
  if (plan.grain) {
    const grainSql = renderGrain(qualify(plan.grain.field), plan.grain.unit);
    selectParts.push(`${grainSql} AS ${plan.grain.output}`);
    groupByParts.push(plan.grain.output);
  }

  // Dimensions. With joins in scope every selection is qualified and aliased so
  // grouping can reference the (quoted) alias unambiguously.
  for (const dimension of plan.dimensions) {
    if (hasJoins) {
      const alias = quoteQualified(dimension.name);
      selectParts.push(`${qualify(dimension.field)} AS ${alias}`);
      groupByParts.push(alias);
    } else {
      const columnSql = dimension.field === dimension.name
        ? dimension.name
        : `${dimension.field} AS ${dimension.name}`;
      selectParts.push(columnSql);
      groupByParts.push(dimension.name);
    }
  }

  // Apply SELECT clause
  if (selectParts.length > 0) {
    qb = qb.select(selectParts);
  }

  // Apply GROUP BY before aggregations so the builder does not auto-infer it
  // from the SELECT list. Inference re-derives group keys from the selection
  // strings and cannot parse quoted, dotted joined aliases; setting it
  // explicitly first keeps `GROUP BY status, \`customer.country\`` correct.
  if (groupByParts.length > 0) {
    qb = qb.groupBy(groupByParts);
  }

  // Apply aggregations (measures)
  qb = applyAggregations(qb, plan, qualify);

  // Apply tenant filter (auto-injected)
  if (plan.tenant) {
    qb = qb.where(qualify(plan.tenant.field), plan.tenant.operator, plan.tenant.value);
  }

  // Apply user filters
  qb = applyFilters(qb, plan.filters, qualify);

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

  // Passthrough columns (grain + dimensions). Joined dimensions surface from
  // the CTE under their quoted qualified alias.
  const passthrough = [
    ...(plan.input.grain ? [plan.input.grain.output] : []),
    ...plan.input.dimensions.map((dim) => quoteQualified(dim.name)),
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
      (order) => `${quoteQualified(order.field)} ${order.direction.toUpperCase()}`
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
 * @deprecated The plan/backend execution path is frozen (bug fixes only) and
 * will not gain new features. Share a query builder instead:
 * `createDatasetClient({ queryBuilder: createQueryBuilder(config) })`.
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
