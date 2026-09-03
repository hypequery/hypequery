import type { MCPExecutorConfig } from '../executor.js';

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object';
}

function getTenantKey(dataset: unknown): string | undefined {
  if (!isRecord(dataset)) {
    return undefined;
  }

  const config = dataset.config;
  const configTenantKey = isRecord(config) ? config.tenantKey : undefined;
  const tenantKey = dataset.tenantKey ?? configTenantKey;
  return typeof tenantKey === 'string' && tenantKey.length > 0 ? tenantKey : undefined;
}

export function validateMCPServerTenantConfig(config: MCPExecutorConfig): void {
  if (config.tenantId) {
    return;
  }

  const tenantScopedDatasets = Object.entries(config.datasets ?? {})
    .filter(([, dataset]) => getTenantKey(dataset))
    .map(([name]) => name);

  if (tenantScopedDatasets.length > 0) {
    throw new Error(
      `MCP server tenantId is required for tenant-scoped datasets: ${tenantScopedDatasets.join(', ')}`,
    );
  }
}
