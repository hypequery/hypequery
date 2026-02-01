import type {
  AuthContext,
  ServeContextFactory,
  ServeInitializer,
  ServeQueriesMap,
  ServeConfig,
} from "../types.js";
import { createProcedureBuilder } from "../builder.js";
import { defineServe } from "./define-serve.js";

type InferInitializerContext<
  TFactory,
  TAuth extends AuthContext
> = TFactory extends ServeContextFactory<infer TContext, TAuth> ? TContext : never;

type ServeInitializerOptions<
  TFactory extends ServeContextFactory<any, TAuth>,
  TAuth extends AuthContext
> = Omit<
  ServeConfig<
    InferInitializerContext<TFactory, TAuth>,
    TAuth,
    ServeQueriesMap<InferInitializerContext<TFactory, TAuth>, TAuth>
  >,
  "queries" | "context"
> & { context: TFactory };

type ServeInitializerDefinition<
  TContext extends Record<string, unknown>,
  TAuth extends AuthContext,
  TQueries extends ServeQueriesMap<TContext, TAuth>
> = Omit<ServeConfig<TContext, TAuth, TQueries>, "context">;

export const initServe = <
  TFactory extends ServeContextFactory<any, TAuth>,
  TAuth extends AuthContext = AuthContext
>(options: ServeInitializerOptions<TFactory, TAuth>): ServeInitializer<
  InferInitializerContext<TFactory, TAuth>,
  TAuth
> => {
  type TContext = InferInitializerContext<TFactory, TAuth>;
  const { context, ...staticOptions } = options;
  const procedure = createProcedureBuilder<TContext, TAuth>();

  return {
    procedure,
    query: procedure,
    queries: <TQueries extends ServeQueriesMap<TContext, TAuth>>(
      definitions: TQueries
    ) => definitions,
    define: <TQueries extends ServeQueriesMap<TContext, TAuth>>(
      config: ServeInitializerDefinition<TContext, TAuth, TQueries>
    ) => {
      return defineServe<TContext, TAuth, TQueries>({
        ...staticOptions,
        ...config,
        context: (context ?? {}) as ServeContextFactory<TContext, TAuth>,
      });
    },
  } satisfies ServeInitializer<TContext, TAuth>;
};
