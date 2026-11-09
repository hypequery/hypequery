import type { QueryBuilderFactoryLike, QueryBuilderLike } from '@hypequery/datasets';

export interface SemanticFixtureStreamOptions {
  /** Rows per streamed batch. */
  batchSize?: number;
  /** Fail a row stream after this many batches. */
  failAfterBatches?: number;
  /** The bytes an Arrow stream returns. */
  arrowBytes?: Uint8Array;
}

/** Deterministic recording backend for HTTP fixtures; actually applies LIMIT/OFFSET. */
export function semanticFixtureBuilder(
  rows: Array<Record<string, unknown>>,
  streams: SemanticFixtureStreamOptions = {},
): QueryBuilderFactoryLike {
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
        execute: async <T = Record<string, unknown>>() => project() as T[],
        stream: async <T = Record<string, unknown>>() => {
          const projected = project();
          const size = streams.batchSize ?? projected.length;
          let batches = 0;
          let at = 0;
          return new ReadableStream<T[]>({
            pull(controller) {
              if (streams.failAfterBatches !== undefined && batches >= streams.failAfterBatches) {
                controller.error(new Error('Code: 396. DB::Exception: private detail. (TOO_MANY_ROWS_OR_BYTES)'));
                return;
              }
              if (at >= projected.length) { controller.close(); return; }
              controller.enqueue(projected.slice(at, at + size) as T[]);
              at += size;
              batches += 1;
            },
          });
        },
        streamArrow: async () => new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(streams.arrowBytes ?? new Uint8Array());
            controller.close();
          },
        }),
      };
      const project = () => rows.slice(offset, offset + limit).map(row => Object.fromEntries(
        fields.map(field => {
          const name = field.match(/\bAS\s+[`"]?([^`"\s]+)[`"]?$/i)?.[1] ?? field.replaceAll('`', '');
          return [name, row[name]];
        }),
      ));
      return builder;
    },
  };
}
