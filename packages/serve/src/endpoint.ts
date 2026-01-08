import { z } from "zod";

import type {
  EndpointHandler,
  EndpointMetadata,
  ExecutableQuery,
  HttpMethod,
  LegacyQueryResolver,
  QueryRuntimeContext,
  QueryResolver,
  QueryResolverArgs,
  ServeEndpoint,
  ServeQueryConfig,
} from "./types";

type QueryDefinition = ServeQueryConfig<any, any, any> | ExecutableQuery<any, any, any>;

const fallbackSchema = z.any();

const isServeQueryConfig = (value: QueryDefinition): value is ServeQueryConfig<any, any, any> => {
  return typeof value === "object" && value !== null && "query" in value;
};

const resolveQueryRunner = <TInput, TResult>(
  query: ExecutableQuery<TInput, TResult, any> | undefined
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

  return async (args: QueryResolverArgs<TInput, any>) => {
    if (fn.length >= 2) {
      return (fn as LegacyQueryResolver<TInput, TResult, any>)(args.input, args.ctx);
    }
    return (fn as QueryResolver<TInput, TResult, any>)(args);
  };
};

export const createEndpoint = (
  key: string,
  definition: QueryDefinition
): ServeEndpoint<any, any, any> => {
  const normalized = isServeQueryConfig(definition)
    ? definition
    : ({ query: definition } satisfies ServeQueryConfig<any, any, any>);

  const method = normalized.method ?? "GET";
  const metadata: EndpointMetadata = {
    path: "",
    method: method as HttpMethod,
    summary: normalized.summary,
    description: normalized.description,
    tags: normalized.tags ?? [],
    requiresAuth: normalized.auth ? true : undefined,
    deprecated: undefined,
    visibility: "public",
  };
  const runner = resolveQueryRunner(normalized.query);

  const handler: EndpointHandler = async (ctx) => {
    if (!runner) {
      throw new Error(`Endpoint \\"${key}\\" is missing an executable query`);
    }

    return runner({
      input: ctx.input,
      ctx: ctx as QueryRuntimeContext,
    });
  };

  return {
    key,
    method,
    inputSchema: normalized.inputSchema,
    outputSchema: (normalized.outputSchema ?? fallbackSchema) as ServeEndpoint["outputSchema"],
    handler,
    query: normalized.query,
    middlewares: normalized.middlewares ?? [],
    auth: normalized.auth ?? null,
    metadata,
    cacheTtlMs: normalized.cacheTtlMs ?? null,
    defaultHeaders: undefined,
  } satisfies ServeEndpoint<any, any, any>;
};
