import type { QueryBuilderFactoryLike } from "@hypequery/datasets";

const UNBOUND_MESSAGE =
  "createAPI: no query builder is available yet. `context` is a function, so the builder " +
  "is read from `ctx.db` on each request, and no request has supplied one. Return the " +
  "createQueryBuilder(config) result as `db` from `context`, or pass it to serve() as `queryBuilder`.";

export interface ContextQueryBuilder {
  /** Stand-in builder for construction-time wiring; delegates to the bound builder. */
  readonly builder: QueryBuilderFactoryLike;
  /** The builder bound from the first request's context, if any. */
  current(): QueryBuilderFactoryLike | undefined;
  /**
   * Binds the first builder a request's context returns, and maps later
   * requests that return the same builder back to the stand-in, so they share
   * the stand-in's identity (and with it the dataset client's result cache).
   * A different builder is returned as-is and runs as a per-call override.
   */
  resolve(fromContext: QueryBuilderFactoryLike): QueryBuilderFactoryLike;
  /**
   * Builder for a request whose context returned no `db`. It always throws,
   * so the request never falls back to a builder another request supplied.
   */
  readonly missing: QueryBuilderFactoryLike;
}

const throwingBuilder = (message: string): QueryBuilderFactoryLike => ({
  table() {
    throw new Error(message);
  },
  async rawQuery() {
    throw new Error(message);
  },
});

/**
 * Lets semantic endpoints be built when the query builder only exists per
 * request, as with `context: () => ({ db })`.
 */
export function createContextQueryBuilder(): ContextQueryBuilder {
  let bound: QueryBuilderFactoryLike | undefined;
  const target = (): QueryBuilderFactoryLike => {
    if (!bound) throw new Error(UNBOUND_MESSAGE);
    return bound;
  };

  const builder: QueryBuilderFactoryLike = {
    get datasetSqlDialect() {
      return bound?.datasetSqlDialect;
    },
    table: (name) => target().table(name),
    rawQuery<T = Record<string, unknown>>(
      sql: string,
      params?: unknown[],
      options?: { abortSignal?: AbortSignal },
    ) {
      return target().rawQuery<T>(sql, params, options);
    },
    // Optional on the protocol: present only when the bound builder can
    // stream, so a builder that cannot still gets its clear error.
    get rawStream() {
      return bound?.rawStream?.bind(bound);
    },
    get rawArrowStream() {
      return bound?.rawArrowStream?.bind(bound);
    },
  };

  return {
    builder,
    current: () => bound,
    resolve(fromContext) {
      bound ??= fromContext;
      return fromContext === bound ? builder : fromContext;
    },
    missing: throwingBuilder(
      "createAPI: this request's context returned no query builder as `db`, which semantic " +
      "endpoints need. Return the createQueryBuilder(config) result as `db` from `context`, " +
      "or pass it to serve() as `queryBuilder`.",
    ),
  };
}
