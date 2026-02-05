import type { AuthContext, ServeContextFactory, ServeInitializer, ServeQueriesMap, ServeConfig } from "../types.js";
type InferInitializerContext<TFactory, TAuth extends AuthContext> = TFactory extends ServeContextFactory<infer TContext, TAuth> ? TContext : never;
type ServeInitializerOptions<TFactory extends ServeContextFactory<any, TAuth>, TAuth extends AuthContext> = Omit<ServeConfig<InferInitializerContext<TFactory, TAuth>, TAuth, ServeQueriesMap<InferInitializerContext<TFactory, TAuth>, TAuth>>, "queries" | "context"> & {
    context: TFactory;
};
export declare const initServe: <TFactory extends ServeContextFactory<any, TAuth>, TAuth extends AuthContext = AuthContext>(options: ServeInitializerOptions<TFactory, TAuth>) => ServeInitializer<InferInitializerContext<TFactory, TAuth>, TAuth>;
export {};
//# sourceMappingURL=init-serve.d.ts.map