import type { QueryBuilderFactoryLike, SemanticExecutionRuntime } from "@hypequery/datasets";

export const INTERNAL_SEMANTIC_RUNTIME_KEY = "__hypequerySemanticRuntime";

export function attachSemanticQueryBuilder<
  TContext extends Record<string, unknown>,
>(
  context: TContext,
  builderFactory: QueryBuilderFactoryLike | undefined,
): TContext {
  if (!builderFactory) {
    return context;
  }

  return attachSemanticRuntime(context, { builderFactory });
}

export function attachSemanticRuntime<TContext extends Record<string, unknown>>(
  context: TContext,
  runtime: SemanticExecutionRuntime,
): TContext {
  const current = resolveSemanticExecutionRuntime(context);
  return {
    ...context,
    [INTERNAL_SEMANTIC_RUNTIME_KEY]: {
      ...(current ?? {}),
      ...runtime,
      tenant: runtime.tenant ?? current?.tenant,
    } satisfies SemanticExecutionRuntime,
  };
}

export function resolveSemanticExecutionRuntime(
  context: Record<string, unknown>,
): SemanticExecutionRuntime | undefined {
  const candidate = context[INTERNAL_SEMANTIC_RUNTIME_KEY];
  if (!candidate || typeof candidate !== "object") {
    return undefined;
  }
  return candidate as SemanticExecutionRuntime;
}

export function resolveSemanticQueryBuilder(
  context: Record<string, unknown>,
  fallback: QueryBuilderFactoryLike,
): QueryBuilderFactoryLike {
  return resolveSemanticExecutionRuntime(context)?.builderFactory ?? fallback;
}

export function attachSemanticTenantRuntime<TContext extends Record<string, unknown>>(
  context: TContext,
  options: {
    tenantId: string;
    tenantColumn?: string;
    tenantHandledByBuilder?: boolean;
  },
): TContext {
  return attachSemanticRuntime(context, {
    tenant: options.tenantColumn
      ? {
          id: options.tenantId,
          column: options.tenantColumn,
          handledByBuilder: options.tenantHandledByBuilder === true,
        }
      : undefined,
  });
}
