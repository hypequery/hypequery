import type { QueryBuilderFactoryLike, SemanticExecutionRuntime } from "@hypequery/datasets";

export const INTERNAL_SEMANTIC_RUNTIME_KEY = "__hypequerySemanticRuntime";

function isSemanticExecutionRuntime(value: unknown): value is SemanticExecutionRuntime {
  return typeof value === 'object' && value !== null;
}

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
  if (!isSemanticExecutionRuntime(candidate)) {
    return undefined;
  }
  return candidate;
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
  },
): TContext {
  return attachSemanticRuntime(context, {
    tenant: {
      id: options.tenantId,
    },
  });
}
