/**
 * Test support for the decision 0005 byte-identical SQL corpora.
 *
 * Not shipped: `src/tests/support` is excluded from the package build. Shared
 * by every corpus so each compares SQL rendered by exactly the same rules.
 */

import type { QueryBuilderFactoryLike, QueryBuilderLike } from '../../query-builder-protocol.js';

// ---------------------------------------------------------------------------
// A faithful renderer. Values are inlined rather than parameterized so one
// string carries both the shape of the query and the values bound into it —
// a divergence in either is then a divergence in the compared artifact.
// ---------------------------------------------------------------------------

function literal(value: unknown): string {
  if (value === null || value === undefined) return 'NULL';
  if (Array.isArray(value)) return `(${value.map(literal).join(', ')})`;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (value instanceof Date) return `'${value.toISOString()}'`;
  return `'${String(value).replace(/'/g, "''")}'`;
}

const OPERATORS: Record<string, string> = {
  eq: '=', neq: '!=', gt: '>', gte: '>=', lt: '<', lte: '<=',
  in: 'IN', notIn: 'NOT IN', like: 'LIKE', between: 'BETWEEN',
};

function condition(column: string, operator: string, value: unknown): string {
  const rendered = OPERATORS[operator] ?? operator.toUpperCase();
  if (operator === 'between' && Array.isArray(value)) {
    return `${column} BETWEEN ${literal(value[0])} AND ${literal(value[1])}`;
  }
  return `${column} ${rendered} ${literal(value)}`;
}

export function createRenderingBuilderFactory(): QueryBuilderFactoryLike {
  function createBuilder(table: string): QueryBuilderLike {
    const select: string[] = [];
    const joins: string[] = [];
    const where: string[] = [];
    const groupBy: string[] = [];
    const orderBy: string[] = [];
    let limit: number | undefined;
    let offset: number | undefined;

    const agg = (fn: string) => (column: string, alias?: string) => {
      select.push(`${fn}(${column}) AS ${alias ?? `${column}_${fn.toLowerCase()}`}`);
      return builder;
    };
    const join = (keyword: string) => (
      joinTable: string,
      leftColumn: string,
      rightColumn: string,
      alias?: string,
      on?: { column: string; operator: string; value: unknown }
        | { column: string; operator: string; value: unknown }[],
    ) => {
      const conditions = on === undefined ? [] : (Array.isArray(on) ? on : [on]);
      const extra = conditions
        .map(entry => ` AND ${condition(entry.column, entry.operator, entry.value)}`)
        .join('');
      joins.push(
        `${keyword} ${alias ? `${joinTable} AS ${alias}` : joinTable} `
        + `ON ${leftColumn} = ${rightColumn}${extra}`,
      );
      return builder;
    };

    const builder: QueryBuilderLike = {
      select: columns => {
        select.push(...(Array.isArray(columns) ? columns : [columns]));
        return builder;
      },
      sum: agg('SUM'),
      count: agg('COUNT'),
      countDistinct: (column, alias) => {
        select.push(`COUNT(DISTINCT ${column}) AS ${alias ?? `${column}_countDistinct`}`);
        return builder;
      },
      avg: agg('AVG'),
      min: agg('MIN'),
      max: agg('MAX'),
      argMax: (column, argColumn, alias) => {
        select.push(`argMax(${column}, ${argColumn}) AS ${alias ?? `${column}_argMax`}`);
        return builder;
      },
      argMin: (column, argColumn, alias) => {
        select.push(`argMin(${column}, ${argColumn}) AS ${alias ?? `${column}_argMin`}`);
        return builder;
      },
      quantile: (column, level, alias) => {
        select.push(`quantile(${level})(${column}) AS ${alias ?? `${column}_quantile`}`);
        return builder;
      },
      stddev: agg('stddevSamp'),
      variance: agg('varSamp'),
      where: (column, operator, value) => {
        where.push(condition(column, operator, value));
        return builder;
      },
      leftJoin: join('LEFT JOIN'),
      leftAnyJoin: join('LEFT ANY JOIN'),
      groupBy: columns => {
        groupBy.push(...(Array.isArray(columns) ? columns : [columns]));
        return builder;
      },
      orderBy: (column, direction) => {
        orderBy.push(`${column} ${direction ?? 'ASC'}`);
        return builder;
      },
      limit: count => { limit = count; return builder; },
      offset: count => { offset = count; return builder; },
      toSQLWithParams: () => {
        let sql = `SELECT ${select.length > 0 ? select.join(', ') : '*'} FROM ${table}`;
        if (joins.length > 0) sql += ` ${joins.join(' ')}`;
        if (where.length > 0) sql += ` WHERE ${where.join(' AND ')}`;
        if (groupBy.length > 0) sql += ` GROUP BY ${groupBy.join(', ')}`;
        if (orderBy.length > 0) sql += ` ORDER BY ${orderBy.join(', ')}`;
        if (limit !== undefined) sql += ` LIMIT ${limit}`;
        if (offset !== undefined) sql += ` OFFSET ${offset}`;
        return { sql, parameters: [] };
      },
      execute: async () => [],
    };
    return builder;
  }

  return { table: createBuilder, rawQuery: async () => [] };
}

/** Every size-`size` subset of `items`, in input order. */
export function subsets<T>(items: readonly T[], size: number): T[][] {
  if (size === 0) return [[]];
  if (items.length < size) return [];
  const [head, ...rest] = items;
  return [
    ...subsets(rest, size - 1).map(tail => [head, ...tail]),
    ...subsets(rest, size),
  ];
}
