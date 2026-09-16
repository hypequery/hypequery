import type { SemanticExpression } from '../semantic-plan.js';
import type { AnyDatasetInstance, DatasetQuery, DerivedMeasureDefinition } from '../types.js';
import type { QueryBuilderLike } from '../query-builder-protocol.js';
import { quoteSQLIdentifier } from '../sql-utils.js';
import { validateDatasetQueryInput } from './dataset-query-validation.js';
import type { DatasetQueryExecutionOptions } from '../dataset-query.js';

type BuildBaseQuery = (
  dataset: AnyDatasetInstance,
  query: DatasetQuery,
  options: DatasetQueryExecutionOptions,
) => QueryBuilderLike;

export function hasSelectedDerivedMeasure(ds: AnyDatasetInstance, query: DatasetQuery): boolean {
  return (query.measures ?? []).some(name => Object.hasOwn(ds.derivedMeasures, name));
}

function expressionSql(expression: SemanticExpression, uses: Readonly<Record<string, string>>): string {
  switch (expression.kind) {
    case 'ref': {
      if (!Object.hasOwn(uses, expression.name)) {
        throw new Error(`Formula references undeclared input "${expression.name}".`);
      }
      const measureName = uses[expression.name];
      return quoteSQLIdentifier(measureName);
    }
    case 'literal': {
      if (expression.value === null) return 'NULL';
      if (typeof expression.value === 'number') {
        if (!Number.isFinite(expression.value)) throw new Error('Formula contains a non-finite number.');
        return String(expression.value);
      }
      if (typeof expression.value === 'boolean') return expression.value ? 'true' : 'false';
      return `'${expression.value.replace(/\\/g, '\\\\').replace(/'/g, "''")}'`;
    }
    case 'binary': {
      const operators = { add: '+', subtract: '-', multiply: '*', divide: '/' } as const;
      const operator = operators[expression.operator];
      if (!operator) throw new Error('Formula contains an unsupported binary operator.');
      return `(${expressionSql(expression.left, uses)} ${operator} ${expressionSql(expression.right, uses)})`;
    }
    case 'function': {
      const args = expression.args.map(arg => expressionSql(arg, uses));
      switch (expression.name) {
        case 'nullIfZero': return `NULLIF(${args[0]}, 0)`;
        case 'coalesce': return `COALESCE(${args.join(', ')})`;
        case 'round': return `ROUND(${args.join(', ')})`;
        case 'floor': return `FLOOR(${args[0]})`;
        case 'ceil': return `CEIL(${args[0]})`;
        default: throw new Error('Formula contains an unsupported function.');
      }
    }
  }
}

function derivedProjection(name: string, definition: DerivedMeasureDefinition): string {
  const aliases = Object.fromEntries(Object.keys(definition.uses).map(alias => [alias, alias]));
  return `${expressionSql(definition.formula(aliases).expression, definition.uses)} AS ${quoteSQLIdentifier(name)}`;
}

export function buildDerivedDatasetSql(
  ds: AnyDatasetInstance,
  query: DatasetQuery,
  options: DatasetQueryExecutionOptions,
  buildBaseQuery: BuildBaseQuery,
): { sql: string; parameters: unknown[] } {
  const validation = validateDatasetQueryInput(ds, query, options.context);
  if (!validation.valid) {
    throw new Error(`Invalid dataset query: ${validation.errors.join('; ')}`);
  }

  const selected = query.measures ?? Object.keys(ds.measures);
  const baseMeasures = new Set(selected.filter(name => Object.hasOwn(ds.measures, name)));
  for (const name of selected) {
    const derived = Object.hasOwn(ds.derivedMeasures, name) ? ds.derivedMeasures[name] : undefined;
    if (derived) Object.values(derived.uses).forEach(base => baseMeasures.add(base));
  }
  const inner = buildBaseQuery(ds, {
    ...query,
    measures: [...baseMeasures],
    orderBy: undefined,
    limit: undefined,
    offset: undefined,
  }, { ...options, executionLimit: undefined, skipDefaultOrderBy: true });
  const { sql: innerSql, parameters } = inner.toSQLWithParams();

  const projections: string[] = [];
  if (query.by) projections.push(quoteSQLIdentifier('period'));
  for (const dimension of query.dimensions ?? []) projections.push(quoteSQLIdentifier(dimension));
  for (const name of selected) {
    const derived = Object.hasOwn(ds.derivedMeasures, name) ? ds.derivedMeasures[name] : undefined;
    projections.push(derived
      ? derivedProjection(name, derived)
      : quoteSQLIdentifier(name));
  }
  let sql = `WITH base AS (${innerSql}) SELECT ${projections.join(', ')} FROM base`;

  if (query.orderBy?.length) {
    sql += ` ORDER BY ${query.orderBy.map(order => (
      `${quoteSQLIdentifier(order.field)} ${order.direction === 'asc' ? 'ASC' : 'DESC'}`
    )).join(', ')}`;
  } else if (query.by) {
    sql += ` ORDER BY ${quoteSQLIdentifier('period')} ASC`;
  }
  const limit = options.executionLimit ?? query.limit;
  if (limit !== undefined) sql += ` LIMIT ${limit}`;
  if (query.offset !== undefined) sql += ` OFFSET ${query.offset}`;
  return { sql, parameters };
}
