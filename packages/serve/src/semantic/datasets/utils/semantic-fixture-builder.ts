import type { QueryBuilderFactoryLike, QueryBuilderLike } from '@hypequery/datasets';

/** Deterministic recording backend for HTTP fixtures; actually applies LIMIT/OFFSET. */
export function semanticFixtureBuilder(rows: Array<Record<string, unknown>>): QueryBuilderFactoryLike {
  return {
    rawQuery: async <T = Record<string, unknown>>() => rows as T[],
    table: () => {
      let limit = rows.length;
      let offset = 0;
      const fields: string[] = [];
      const builder: QueryBuilderLike = {
        select: (columns) => { fields.push(...(Array.isArray(columns) ? columns : [columns])); return builder; },
        count: (_column, alias) => { fields.push(alias ?? 'count'); return builder; },
        sum: (_column, alias) => { fields.push(alias ?? 'sum'); return builder; },
        avg: (_column, alias) => { fields.push(alias ?? 'avg'); return builder; },
        min: (_column, alias) => { fields.push(alias ?? 'min'); return builder; },
        max: (_column, alias) => { fields.push(alias ?? 'max'); return builder; },
        countDistinct: (_column, alias) => { fields.push(alias ?? 'countDistinct'); return builder; },
        leftJoin: () => builder, where: () => builder, groupBy: () => builder, orderBy: () => builder,
        limit: (value) => { limit = value; return builder; },
        offset: (value) => { offset = value; return builder; },
        toSQLWithParams: () => ({ sql: 'SELECT private_columns FROM private_orders', parameters: [] }),
        execute: async <T = Record<string, unknown>>() => rows.slice(offset, offset + limit).map(row => Object.fromEntries(
          fields.map(field => {
            const name = field.match(/\bAS\s+[`"]?([^`"\s]+)[`"]?$/i)?.[1] ?? field.replaceAll('`', '');
            return [name, row[name]];
          }),
        )) as T[],
      };
      return builder;
    },
  };
}
