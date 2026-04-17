import type {
  AuthContext,
  ServeConfig,
  ServeBuilder,
  ServeEndpointMap,
  ServeQueriesMap,
  ExecutableQuery,
} from "./types.js";
import { defineServe } from "./server/define-serve.js";

/**
 * Create a reusable query object that can be run independently or served via HTTP
 *
 * @example
 * ```typescript
 * const revenue = query({
 *   input: z.object({ startDate: z.string() }),
 *   query: async ({ input, ctx }) => {
 *     return ctx.db.table('orders').execute()
 *   }
 * })
 *
 * // Run directly
 * await revenue.run({ input: { startDate: '2024-01-01' }, ctx: { db } })
 *
 * // Or serve via HTTP
 * serve({ revenue })
 * ```
 */
export function query<
  TInput = unknown,
  TResult = unknown,
  TContext extends Record<string, unknown> = Record<string, unknown>,
  TAuth extends AuthContext = AuthContext
>(config: {
  input?: any;
  output?: any;
  name?: string;
  description?: string;
  summary?: string;
  tags?: string[];
  query: (args: { input: TInput; ctx: TContext & { auth?: TAuth } }) => Promise<TResult>;
}): ExecutableQuery<TInput, TResult, TContext & { auth?: TAuth }> {
  return {
    run: config.query,
    ...(config.input && { inputSchema: config.input }),
    ...(config.output && { outputSchema: config.output }),
    ...(config.name && { name: config.name }),
    ...(config.description && { description: config.description }),
    ...(config.summary && { summary: config.summary }),
    ...(config.tags && { tags: config.tags }),
  };
}

/**
 * Simplified serve API - flattened version of defineServe
 * Accepts query objects created with query() or standard ServeQueryConfig
 *
 * @example
 * ```typescript
 * const revenue = query({
 *   query: async ({ ctx }) => ctx.db.table('orders').execute()
 * })
 *
 * const api = serve({
 *   context: () => ({ db }),
 *   revenue
 * })
 * ```
 */
export function serve<
  TContext extends Record<string, unknown> = Record<string, unknown>,
  TAuth extends AuthContext = AuthContext,
  TQueries extends ServeQueriesMap<TContext, TAuth> = ServeQueriesMap<TContext, TAuth>
>(config: ServeConfig<TContext, TAuth, TQueries>): ServeBuilder<ServeEndpointMap<TQueries, TContext, TAuth>, TContext, TAuth> {
  return defineServe<TContext, TAuth, TQueries>(config);
}
