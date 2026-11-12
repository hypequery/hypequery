import type { DatasetsConfig, MetricsConfig } from '../../../types.js';
import { resolveMetricEntry } from '../metric-endpoint.js';
import { resolveDatasetEntry } from './dataset-entry.js';

/**
 * A dataset or metric whose own entry options decide who may query it over REST.
 * The MCP transport serves the registered definitions and applies only the
 * application's global auth and tenant, so these options would be silently skipped.
 */
export interface McpRestrictedEntry {
  readonly kind: 'dataset' | 'metric';
  /** The registration name. */
  readonly name: string;
  /** The entry options that carry the rule, such as `requiredRoles`. */
  readonly rules: readonly string[];
}

interface EndpointRules {
  auth?: unknown;
  requiredRoles?: readonly string[];
  requiredScopes?: readonly string[];
  middlewares?: readonly unknown[];
  tenant?: unknown;
}

function rulesOf(entry: EndpointRules): string[] {
  const rules: string[] = [];
  // `requiresAuth: false` is not listed: MCP over HTTP always authenticates, which is stricter.
  if (entry.auth != null) rules.push('auth');
  if ((entry.requiredRoles?.length ?? 0) > 0) rules.push('requiredRoles');
  if ((entry.requiredScopes?.length ?? 0) > 0) rules.push('requiredScopes');
  if ((entry.middlewares?.length ?? 0) > 0) rules.push('middlewares');
  // A per-dataset tenant override can resolve a different tenant than the global one.
  if (entry.tenant !== undefined) rules.push('tenant');
  return rules;
}

/** Every registered dataset and metric that carries endpoint-level access rules. */
export function collectMcpRestrictions(
  datasets: DatasetsConfig<any> | undefined,
  metrics: MetricsConfig<any> | undefined,
): McpRestrictedEntry[] {
  const restricted: McpRestrictedEntry[] = [];
  for (const [name, entry] of Object.entries(datasets ?? {})) {
    const rules = rulesOf(resolveDatasetEntry(entry));
    if (rules.length > 0) restricted.push({ kind: 'dataset', name, rules });
  }
  for (const [name, entry] of Object.entries(metrics ?? {})) {
    const rules = rulesOf(resolveMetricEntry(entry));
    if (rules.length > 0) restricted.push({ kind: 'metric', name, rules });
  }
  return restricted;
}
