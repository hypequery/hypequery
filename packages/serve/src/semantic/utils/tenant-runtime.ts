import { createTenantScope, warnTenantMisconfiguration } from '../../tenant.js';
import type { EndpointMetadata } from '../../types.js';
import {
  attachSemanticTenantRuntime,
} from '../query-builder-context.js';

type TableFactoryContext = {
  table: (name: string) => unknown;
};

function usesServeTenantRuntimeMetadata(metadata: EndpointMetadata): boolean {
  return Boolean(
    metadata.custom
      && typeof metadata.custom === 'object'
      && metadata.custom !== null
      && 'usesServeTenantRuntime' in metadata.custom
      && metadata.custom.usesServeTenantRuntime === true,
  );
}

function hasTableFactory(value: unknown): value is TableFactoryContext {
  return !!value && typeof value === 'object' && 'table' in value && typeof value.table === 'function';
}

export function applySemanticTenantRuntime<TContext extends Record<string, unknown>>(
  context: TContext & { tenantId?: string },
  options: {
    queryKey: string;
    metadata: EndpointMetadata;
    tenantId: string;
    mode: 'manual' | 'auto-inject';
    column?: string;
  },
): void {
  const mutableContext: Record<string, unknown> = context;
  const usesServeTenantRuntime = usesServeTenantRuntimeMetadata(options.metadata);

  Object.assign(
    context,
    attachSemanticTenantRuntime(context, {
      tenantId: options.tenantId,
      column: options.mode === 'auto-inject' ? options.column : undefined,
    }),
  );

  if (options.mode === 'auto-inject' && options.column) {
    for (const key of Object.keys(mutableContext)) {
      const value = mutableContext[key];
      if (hasTableFactory(value)) {
        mutableContext[key] = createTenantScope(value, {
          tenantId: options.tenantId,
          column: options.column,
        });
      }
    }
  } else if (options.mode === 'manual' && !usesServeTenantRuntime) {
    warnTenantMisconfiguration({
      queryKey: options.queryKey,
      hasTenantConfig: true,
      hasTenantId: true,
      mode: 'manual',
    });
  }
}
