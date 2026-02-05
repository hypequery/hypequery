import type { AuthContext, ServeEndpoint, ServeQueryConfig } from "./types.js";
type EndpointFromDefinition<TDefinition extends ServeQueryConfig<any, any, TContext, TAuth, any>, TContext extends Record<string, unknown>, TAuth extends AuthContext> = TDefinition extends ServeQueryConfig<infer TInputSchema, infer TOutputSchema, TContext, TAuth, infer TResult> ? ServeEndpoint<TInputSchema, TOutputSchema, TContext, TAuth, TResult> : ServeEndpoint<any, any, TContext, TAuth>;
export declare const createEndpoint: <TContext extends Record<string, unknown>, TAuth extends AuthContext, TDefinition extends ServeQueryConfig<any, any, TContext, TAuth, any>>(key: string, definition: TDefinition) => EndpointFromDefinition<TDefinition, TContext, TAuth>;
export {};
//# sourceMappingURL=endpoint.d.ts.map