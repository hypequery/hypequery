import type {
  AuthContext,
  QueryFactory,
  ServeContextFactory,
  ServeInitializer,
  ServeQueriesMap,
  ServeConfig,
} from "../types.js";
import { createProcedureBuilder } from "../builder.js";
import { defineServe } from "./define-serve.js";
import { createQueryFactory } from "../serve.js";

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
  const define = <TQueries extends ServeQueriesMap<TContext, TAuth>>(
    config: ServeInitializerDefinition<TContext, TAuth, TQueries>
  ) => {
    return defineServe<TContext, TAuth, TQueries>({
      ...staticOptions,
      ...config,
      context: (context ?? {}) as ServeContextFactory<TContext, TAuth>,
    });
  };
  const queryFactory = createQueryFactory<TContext, TAuth>((context ?? {}) as ServeContextFactory<TContext, TAuth>);
  const query = new Proxy(queryFactory as QueryFactory<TContext, TAuth>, {
    apply(target, thisArg, argArray) {
      return Reflect.apply(target, thisArg, argArray);
    },
    get(target, property, receiver) {
      if (property in procedure) {
        return Reflect.get(procedure as object, property);
      }

      return Reflect.get(target, property, receiver);
    },
  });

  return {
    procedure,
    query,
    queries: <TQueries extends ServeQueriesMap<TContext, TAuth>>(
      definitions: TQueries
    ) => definitions,
    serve: define,
    define,
  } satisfies ServeInitializer<TContext, TAuth>;
};
