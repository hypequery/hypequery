import { z } from "zod";

import type {
  AuthContext,
  EndpointHandler,
  EndpointMetadata,
  ExecutableQuery,
  HttpMethod,
  QueryRuntimeContext,
  QueryResolver,
  QueryResolverArgs,
  SchemaInput,
  SchemaOutput,
  ServeEndpoint,
  ServeQueryConfig,
} from "./types.js";

const fallbackSchema = z.any();

type EndpointFromDefinition<
  TDefinition extends ServeQueryConfig<any, any, TContext, TAuth, any>,
  TContext extends Record<string, unknown>,
  TAuth extends AuthContext
> = TDefinition extends ServeQueryConfig<
  infer TInputSchema,
  infer TOutputSchema,
  TContext,
  TAuth,
  infer TResult
>
  ? ServeEndpoint<TInputSchema, TOutputSchema, TContext, TAuth, TResult>
  : ServeEndpoint<any, any, TContext, TAuth>;

const resolveQueryRunner = <
  TInput,
  TResult,
  TContext extends Record<string, unknown>,
  TAuth extends AuthContext
>(
  query: ExecutableQuery<TInput, TResult, TContext, TAuth> | undefined
) => {
  if (!query) {
    return null;
  }

  const fn =
    typeof query === "function"
      ? query
      : typeof query === "object" && typeof query.run === "function"
        ? query.run.bind(query)
        : null;

  if (!fn) {
    return null;
  }

  return async (args: QueryResolverArgs<TInput, TContext, TAuth>) => {
    return (fn as QueryResolver<TInput, TResult, TContext, TAuth>)(args);
  };
};

export const createEndpoint = <
  TContext extends Record<string, unknown>,
  TAuth extends AuthContext,
  TDefinition extends ServeQueryConfig<any, any, TContext, TAuth, any>
>(
  key: string,
  definition: TDefinition
): EndpointFromDefinition<TDefinition, TContext, TAuth> => {
  type InputSchema = TDefinition extends ServeQueryConfig<infer TInput, any, TContext, TAuth, any>
    ? TInput
    : undefined;
  type OutputSchema = TDefinition extends ServeQueryConfig<any, infer TOutput, TContext, TAuth, any>
    ? TOutput
    : typeof fallbackSchema;
  type TResult = TDefinition extends ServeQueryConfig<any, any, TContext, TAuth, infer TResolved>
    ? TResolved
    : SchemaOutput<OutputSchema>;

  const method = definition.method ?? "GET";
  const metadata: EndpointMetadata = {
    path: "",
    method: method as HttpMethod,
    summary: definition.summary,
    description: definition.description,
    tags: definition.tags ?? [],
    requiresAuth: definition.auth ? true : undefined,
    deprecated: undefined,
    visibility: "public",
    custom: definition.custom,
  };
  const runner = resolveQueryRunner(definition.query);

  const handler: EndpointHandler<SchemaInput<InputSchema>, TResult, TContext, TAuth> = async (ctx) => {
    if (!runner) {
      throw new Error(`Endpoint "${key}" is missing an executable query`);
    }

    return runner({
      input: ctx.input,
      ctx: ctx as QueryRuntimeContext<TContext, TAuth>,
    });
  };

  const outputSchema = (definition.outputSchema ?? fallbackSchema) as OutputSchema;
  const inputSchema = definition.inputSchema as InputSchema;

  return {
    key,
    method,
    inputSchema,
    outputSchema,
    handler,
    query: definition.query,
    middlewares: definition.middlewares ?? [],
    auth: definition.auth ?? null,
    tenant: definition.tenant,
    metadata,
    cacheTtlMs: definition.cacheTtlMs ?? null,
    defaultHeaders: undefined,
  } as EndpointFromDefinition<TDefinition, TContext, TAuth>;
};
