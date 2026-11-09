import type { QueryBuilderFactoryLike, QueryBuilderLike } from '../query-builder-protocol.js';

type Rows = Record<string, unknown>[];

interface RawStatement {
  readonly sql: string;
  readonly parameters: readonly unknown[];
}

/**
 * What a compiled semantic query runs as: the builder itself, which keeps the
 * settings it carries, or a raw statement whose SQL already pins its own.
 */
export type StatementTarget =
  | { kind: 'builder'; builder: QueryBuilderLike }
  | { kind: 'raw'; statement: RawStatement };

/** One compiled query, runnable as a whole result or as a stream. */
export interface StatementRunner {
  execute(): Promise<Rows>;
  stream(): Promise<ReadableStream<Rows>>;
  streamArrow(): Promise<ReadableStream<Uint8Array>>;
}

export interface StatementRunnerOptions {
  abortSignal?: AbortSignal;
  /** Raw statements that must succeed, in order, before the query runs. */
  preflight?: readonly RawStatement[];
}

export function statementRunner(
  factory: QueryBuilderFactoryLike,
  target: StatementTarget,
  options: StatementRunnerOptions = {},
): StatementRunner {
  const { abortSignal, preflight = [] } = options;
  const run = async <T>(open: () => Promise<T>): Promise<T> => {
    for (const statement of preflight) {
      await factory.rawQuery(statement.sql, [...statement.parameters], { abortSignal });
    }
    return open();
  };

  if (target.kind === 'builder') {
    const { builder } = target;
    return {
      execute: () => run(() => builder.execute({ abortSignal })),
      stream: () => run(() => {
        if (!builder.stream) throw unsupported('stream()', 'query builder');
        return builder.stream({ abortSignal });
      }),
      streamArrow: () => run(() => {
        if (!builder.streamArrow) throw unsupported('streamArrow()', 'query builder');
        return builder.streamArrow({ abortSignal });
      }),
    };
  }

  const { sql } = target.statement;
  const parameters = () => [...target.statement.parameters];
  return {
    execute: () => run(() => factory.rawQuery(sql, parameters(), { abortSignal })),
    stream: () => run(() => {
      if (!factory.rawStream) throw unsupported('rawStream()', 'query builder factory');
      return factory.rawStream(sql, parameters(), { abortSignal });
    }),
    streamArrow: () => run(() => {
      if (!factory.rawArrowStream) throw unsupported('rawArrowStream()', 'query builder factory');
      return factory.rawArrowStream(sql, parameters(), { abortSignal });
    }),
  };
}

function unsupported(method: string, owner: string): Error {
  return new Error(
    `Streaming this query needs a ${owner} with ${method}; @hypequery/clickhouse provides it from 2.15.0.`,
  );
}
