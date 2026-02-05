import type { AuthContext, AuthStrategy, HttpMethod, ServeBuilder, ServeEndpointMap, ServeMiddleware, ServeQueriesMap, ServeHandler, ExecuteQueryFunction } from "../types.js";
import type { ServeRouter } from "../router.js";
import { ServeQueryLogger } from "../query-logger.js";
export declare const createBuilderMethods: <TQueries extends ServeQueriesMap<TContext, TAuth>, TContext extends Record<string, unknown>, TAuth extends AuthContext>(queryEntries: ServeEndpointMap<TQueries, TContext, TAuth>, queryLogger: ServeQueryLogger, routeConfig: Record<string, {
    method: HttpMethod;
}>, router: ServeRouter, authStrategies: AuthStrategy<TAuth>[], globalMiddlewares: ServeMiddleware<any, any, TContext, TAuth>[], executeQuery: ExecuteQueryFunction<ServeEndpointMap<TQueries, TContext, TAuth>, TContext, TAuth>, handler: ServeHandler, basePath: string) => ServeBuilder<ServeEndpointMap<TQueries, TContext, TAuth>, TContext, TAuth>;
//# sourceMappingURL=builder.d.ts.map