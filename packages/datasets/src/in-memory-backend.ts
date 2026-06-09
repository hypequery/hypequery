import type {
  MetricFilter,
  MetricOrderBy,
} from './types.js';
import type {
  PlanNode,
  SemanticAggregationPlan,
  SemanticBackend,
  SemanticBackendResult,
  SemanticExpression,
  SemanticGrainPlan,
} from './semantic-plan.js';

export type InMemoryTable = Array<Record<string, unknown>>;
export type InMemoryTables = Record<string, InMemoryTable>;

function valueForField(row: Record<string, unknown>, field: string): unknown {
  return row[field];
}

function compareFilter(actual: unknown, filter: MetricFilter): boolean {
  switch (filter.operator) {
    case 'eq':
      return actual === filter.value;
    case 'neq':
      return actual !== filter.value;
    case 'gt':
      return Number(actual) > Number(filter.value);
    case 'gte':
      return Number(actual) >= Number(filter.value);
    case 'lt':
      return Number(actual) < Number(filter.value);
    case 'lte':
      return Number(actual) <= Number(filter.value);
    case 'in':
      return Array.isArray(filter.value) && filter.value.includes(actual);
    case 'notIn':
      return Array.isArray(filter.value) && !filter.value.includes(actual);
    case 'between':
      return Array.isArray(filter.value)
        && filter.value.length === 2
        && Number(actual) >= Number(filter.value[0])
        && Number(actual) <= Number(filter.value[1]);
    case 'like':
      return typeof actual === 'string'
        && typeof filter.value === 'string'
        && actual.includes(filter.value.replaceAll('%', ''));
    default:
      return false;
  }
}

function applyFilters(rows: InMemoryTable, filters: MetricFilter[]): InMemoryTable {
  return rows.filter((row) => filters.every((filter) => compareFilter(valueForField(row, filter.field), filter)));
}

function applyTenant(
  rows: InMemoryTable,
  tenant?: Extract<PlanNode, { kind: 'aggregate' }>['tenant'],
): InMemoryTable {
  if (!tenant) {
    return rows;
  }
  if (tenant.operator === 'in') {
    return rows.filter((row) => tenant.value.includes(String(row[tenant.field])));
  }
  return rows.filter((row) => row[tenant.field] === tenant.value);
}

function periodForValue(value: unknown, grain: SemanticGrainPlan): string {
  const date = new Date(String(value));
  if (Number.isNaN(date.getTime())) {
    return String(value);
  }

  if (grain.unit === 'year') {
    return `${date.getUTCFullYear()}-01-01`;
  }
  if (grain.unit === 'quarter') {
    const quarterStartMonth = Math.floor(date.getUTCMonth() / 3) * 3;
    return new Date(Date.UTC(date.getUTCFullYear(), quarterStartMonth, 1)).toISOString().slice(0, 10);
  }
  if (grain.unit === 'month') {
    return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1)).toISOString().slice(0, 10);
  }
  if (grain.unit === 'week') {
    const day = date.getUTCDay();
    const weekStart = grain.weekStart ?? 1;
    const diff = (day - weekStart + 7) % 7;
    const start = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() - diff));
    return start.toISOString().slice(0, 10);
  }
  return date.toISOString().slice(0, 10);
}

function groupKey(row: Record<string, unknown>, plan: Extract<PlanNode, { kind: 'aggregate' }>): string {
  const parts = plan.dimensions.map((dimension) => row[dimension.field]);
  if (plan.grain) {
    parts.unshift(periodForValue(row[plan.grain.field], plan.grain));
  }
  return JSON.stringify(parts);
}

function aggregateRows(rows: InMemoryTable, aggregation: SemanticAggregationPlan): number {
  const filteredRows = applyFilters(rows, aggregation.filters ?? []);
  const values = filteredRows.map((row) => row[aggregation.field]);

  switch (aggregation.aggregation) {
    case 'sum':
      return values.reduce<number>((total, value) => total + Number(value ?? 0), 0);
    case 'count':
      return filteredRows.length;
    case 'countDistinct':
      return new Set(values).size;
    case 'avg':
      return values.length === 0
        ? 0
        : values.reduce<number>((total, value) => total + Number(value ?? 0), 0) / values.length;
    case 'min':
      return Math.min(...values.map((value) => Number(value)));
    case 'max':
      return Math.max(...values.map((value) => Number(value)));
    default:
      return 0;
  }
}

function evaluateExpression(expression: SemanticExpression, row: Record<string, unknown>): unknown {
  switch (expression.kind) {
    case 'ref':
      return row[expression.name];
    case 'literal':
      return expression.value;
    case 'binary': {
      const left = Number(evaluateExpression(expression.left, row));
      const right = Number(evaluateExpression(expression.right, row));
      if (expression.operator === 'add') return left + right;
      if (expression.operator === 'subtract') return left - right;
      if (expression.operator === 'multiply') return left * right;
      return right === 0 ? null : left / right;
    }
    case 'function': {
      const [first, second] = expression.args.map((arg) => evaluateExpression(arg, row));
      if (expression.name === 'nullIfZero') return Number(first) === 0 ? null : first;
      if (expression.name === 'coalesce') return first == null ? second : first;
      if (expression.name === 'round') {
        const decimals = Number(second ?? 0);
        const factor = 10 ** decimals;
        return Math.round(Number(first) * factor) / factor;
      }
      if (expression.name === 'floor') return Math.floor(Number(first));
      return Math.ceil(Number(first));
    }
    default:
      return undefined;
  }
}

function compareRows(orderBy: MetricOrderBy[]) {
  return (a: Record<string, unknown>, b: Record<string, unknown>) => {
    for (const order of orderBy) {
      const av = a[order.field] as any;
      const bv = b[order.field] as any;
      if (av === bv) continue;
      const result = av > bv ? 1 : -1;
      return order.direction === 'desc' ? -result : result;
    }
    return 0;
  };
}

function applyOrderLimitOffset(rows: InMemoryTable, plan: Pick<PlanNode, 'orderBy' | 'limit' | 'offset'>): InMemoryTable {
  let result = [...rows];
  if (plan.orderBy?.length) {
    result = result.sort(compareRows(plan.orderBy));
  }
  if (plan.offset != null) {
    result = result.slice(plan.offset);
  }
  if (plan.limit != null) {
    result = result.slice(0, plan.limit);
  }
  return result;
}

export function createInMemoryBackend(tables: InMemoryTables): SemanticBackend {
  function executeAggregate(plan: Extract<PlanNode, { kind: 'aggregate' }>): InMemoryTable {
    const table = tables[plan.source] ?? [];
    const filteredRows = applyFilters(applyTenant(table, plan.tenant), plan.filters);
    const groups = new Map<string, InMemoryTable>();

    for (const row of filteredRows) {
      const key = groupKey(row, plan);
      groups.set(key, [...(groups.get(key) ?? []), row]);
    }

    if (groups.size === 0 && plan.dimensions.length === 0 && !plan.grain) {
      groups.set('[]', []);
    }

    const output = Array.from(groups.values()).map((rows) => {
      const first = rows[0] ?? {};
      const record: Record<string, unknown> = {};

      if (plan.grain) {
        record[plan.grain.output] = periodForValue(first[plan.grain.field], plan.grain);
      }
      for (const dimension of plan.dimensions) {
        record[dimension.name] = first[dimension.field];
      }
      for (const aggregation of plan.aggregations) {
        record[aggregation.name] = aggregateRows(rows, aggregation);
      }
      return record;
    });

    return applyOrderLimitOffset(output, plan);
  }

  async function execute<T = Record<string, unknown>>(plan: PlanNode): Promise<SemanticBackendResult<T>> {
    const start = Date.now();
    let data: InMemoryTable;

    if (plan.kind === 'aggregate') {
      data = executeAggregate(plan);
    } else {
      const input = (await execute<Record<string, unknown>>(plan.input)).data;
      data = input.map((row) => {
        const next: Record<string, unknown> = {};
        if (plan.input.kind === 'aggregate') {
          if (plan.input.grain) {
            next[plan.input.grain.output] = row[plan.input.grain.output];
          }
          for (const dimension of plan.input.dimensions) {
            next[dimension.name] = row[dimension.name];
          }
        }
        for (const metric of plan.metrics) {
          next[metric.name] = evaluateExpression(metric.expression, row);
        }
        return next;
      });
      data = applyOrderLimitOffset(data, plan);
    }

    return {
      data: data as T[],
      meta: { timingMs: Date.now() - start },
    };
  }

  return { execute };
}
