/**
 * Deploy-time diagnostics for managed (Cloud) execution.
 *
 * A deployment contract carries policy, not mechanism: an `AuthStrategy` is
 * reduced to `{ kind, roles, scopes }`, a `TenantConfig.extract` to a column
 * name, and middlewares, hooks, and context factories are not carried at all.
 * That is deliberate — Cloud re-implements those concerns itself — but it means
 * a Serve app can behave differently once deployed, and silently.
 *
 * The dangerous case is tenancy. `resolveTenantFilterColumn` returns the
 * dataset's `tenantKey`, and the planner applies the tenant predicate only when
 * a column resolves. A dataset with no `tenantKey` exposed under a config that
 * requires a tenant will demand a tenant and filter nothing, so every tenant
 * reads every row. Locally a middleware or resolver may cover that gap; in
 * Cloud there is no customer code left to do it.
 *
 * These checks run when the deployment contract is built, so they apply to
 * every consumer rather than only the CLI.
 */

import type { AuthContext, MetricEntry, DatasetEntry, ServeConfig } from './types.js';
import { resolveDatasetEntry } from './semantic/datasets/utils/dataset-entry.js';
import { resolveMetricEntry } from './semantic/datasets/metric-endpoint.js';

export type CloudCompatibilitySeverity = 'error' | 'warning';

export type CloudCompatibilityCode =
  | 'HQ_CLOUD_TENANT_NOT_ENFORCEABLE'
  | 'HQ_CLOUD_MIDDLEWARE_DROPPED'
  | 'HQ_CLOUD_HOOKS_DROPPED'
  | 'HQ_CLOUD_CONTEXT_DROPPED'
  | 'HQ_CLOUD_AUTH_WITHOUT_ROLES';

export interface CloudCompatibilityDiagnostic {
  readonly severity: CloudCompatibilitySeverity;
  readonly code: CloudCompatibilityCode;
  /** The endpoint, dataset, or config key the finding applies to. */
  readonly subject: string;
  readonly message: string;
  /** What the author should do instead. */
  readonly remedy: string;
}

type AnyConfig = ServeConfig<any, any, any, any, any> & {
  readonly middlewares?: readonly unknown[];
  readonly hooks?: unknown;
  readonly context?: unknown;
  readonly auth?: unknown;
  readonly tenant?: { readonly required?: boolean };
  readonly datasets?: Record<string, unknown>;
  readonly metrics?: Record<string, unknown>;
  readonly queries?: Record<string, { readonly middlewares?: readonly unknown[] }>;
};

function tenantIsExpected(
  local: { readonly required?: boolean } | undefined,
  global: { readonly required?: boolean } | undefined,
): boolean {
  if (local === undefined && global === undefined) return false;
  const effective = { ...(global ?? {}), ...(local ?? {}) };
  return effective.required !== false;
}

function hasAuth(auth: unknown): boolean {
  return Array.isArray(auth) ? auth.length > 0 : auth !== undefined && auth !== null;
}

function declaresRolesOrScopes(entry: {
  readonly requiredRoles?: readonly string[];
  readonly requiredScopes?: readonly string[];
}): boolean {
  return (entry.requiredRoles?.length ?? 0) > 0 || (entry.requiredScopes?.length ?? 0) > 0;
}

/**
 * Reports how a Serve config will differ once executed by Cloud.
 *
 * Pure and side-effect free so it can be run for reporting without building a
 * contract.
 */
export function analyzeCloudCompatibility(
  config: ServeConfig<any, any, any, any, any>,
): readonly CloudCompatibilityDiagnostic[] {
  const serveConfig = config as unknown as AnyConfig;
  const diagnostics: CloudCompatibilityDiagnostic[] = [];

  // Semantic endpoints have no customer code in Cloud, so an unenforceable
  // tenant requirement silently becomes no isolation at all.
  const semanticTargets: { readonly label: string; readonly entry: unknown }[] = [
    ...Object.entries(serveConfig.datasets ?? {}).map(([name, entry]) => ({
      label: `datasets.${name}`,
      entry,
    })),
    ...Object.entries(serveConfig.metrics ?? {}).map(([name, entry]) => ({
      label: `metrics.${name}`,
      entry,
    })),
  ];

  for (const { label, entry } of semanticTargets) {
    const resolved = label.startsWith('datasets.')
      ? resolveDatasetEntry(entry as DatasetEntry<AuthContext>)
      : resolveMetricEntry(entry as MetricEntry<AuthContext>);
    const dataset = label.startsWith('datasets.')
      ? (resolved as { dataset: { name: string; tenantKey?: string } }).dataset
      : datasetOfMetric(resolved);

    const local = (resolved as { tenant?: { required?: boolean } }).tenant;
    if (!tenantIsExpected(local, serveConfig.tenant)) continue;
    if (dataset?.tenantKey) continue;

    diagnostics.push({
      severity: 'error',
      code: 'HQ_CLOUD_TENANT_NOT_ENFORCEABLE',
      subject: label,
      message:
        `Tenant isolation is required for "${label}" but dataset `
        + `"${dataset?.name ?? 'unknown'}" declares no tenantKey. Cloud resolves the `
        + 'tenant filter column from the dataset, so it would accept a tenant and '
        + 'return every tenant\'s rows.',
      remedy:
        `Add tenantKey to the "${dataset?.name ?? ''}" dataset, or set `
        + 'tenant.required to false if this data is genuinely shared.',
    });
  }

  // Everything below is dropped by the protocol adapter.
  const globalMiddlewares = serveConfig.middlewares ?? [];
  if (globalMiddlewares.length > 0) {
    diagnostics.push({
      severity: 'error',
      code: 'HQ_CLOUD_MIDDLEWARE_DROPPED',
      subject: 'middlewares',
      message:
        `${globalMiddlewares.length} global middleware(s) are not carried in the `
        + 'deployment contract and will not run in Cloud. Middleware that performs '
        + 'authentication or filtering would leave endpoints less protected than '
        + 'they are locally.',
      remedy:
        'Express the requirement declaratively with requiresAuth, requiredRoles, '
        + 'requiredScopes, or tenant config, or keep this app self-hosted.',
    });
  }

  const queryEntries = Object.entries(serveConfig.queries ?? {}) as [
    string,
    { readonly middlewares?: readonly unknown[] } | undefined,
  ][];
  for (const [name, query] of queryEntries) {
    if ((query?.middlewares?.length ?? 0) === 0) continue;
    diagnostics.push({
      severity: 'error',
      code: 'HQ_CLOUD_MIDDLEWARE_DROPPED',
      subject: `queries.${name}`,
      message:
        `Middleware on query "${name}" is not carried in the deployment contract `
        + 'and will not run in Cloud.',
      remedy:
        'Express the requirement declaratively on the query, or move the logic into '
        + 'the query resolver itself.',
    });
  }

  if (serveConfig.hooks !== undefined) {
    diagnostics.push({
      severity: 'warning',
      code: 'HQ_CLOUD_HOOKS_DROPPED',
      subject: 'hooks',
      message: 'Lifecycle hooks do not run in Cloud.',
      remedy:
        'Cloud records its own request log for deployed endpoints; remove the hooks '
        + 'or keep them for local runs only.',
    });
  }

  if (serveConfig.context !== undefined) {
    diagnostics.push({
      severity: 'warning',
      code: 'HQ_CLOUD_CONTEXT_DROPPED',
      subject: 'context',
      message:
        'The context factory does not run in Cloud, so values it provides will be '
        + 'absent from query resolvers.',
      remedy:
        'Derive those values inside the resolver, or pass them as query input.',
    });
  }

  if (hasAuth(serveConfig.auth)) {
    const undeclared = [
      ...Object.entries(serveConfig.datasets ?? {}).map(([name, entry]) => [
        `datasets.${name}`,
        resolveDatasetEntry(entry as DatasetEntry<AuthContext>),
      ] as const),
      ...Object.entries(serveConfig.metrics ?? {}).map(([name, entry]) => [
        `metrics.${name}`,
        resolveMetricEntry(entry as MetricEntry<AuthContext>),
      ] as const),
    ].filter(([, resolved]) => !declaresRolesOrScopes(resolved as { requiredRoles?: string[] }));

    for (const [label] of undeclared) {
      diagnostics.push({
        severity: 'warning',
        code: 'HQ_CLOUD_AUTH_WITHOUT_ROLES',
        subject: label,
        message:
          `"${label}" is authenticated but declares no roles or scopes. The auth `
          + 'strategy itself is not carried, so Cloud accepts any valid credential '
          + 'for this endpoint even if the local strategy is stricter.',
        remedy:
          'Declare requiredRoles or requiredScopes so Cloud can enforce the same '
          + 'restriction.',
      });
    }
  }

  return diagnostics;
}

function datasetOfMetric(resolved: unknown): { name: string; tenantKey?: string } | undefined {
  const metric = (resolved as { metric?: any }).metric;
  if (!metric) return undefined;
  return metric.__type === 'grained_metric_ref' ? metric.metric?.dataset : metric.dataset;
}

/**
 * Formats diagnostics for a thrown error. Errors are listed first because they
 * are what blocks the deployment.
 */
export function formatCloudCompatibilityDiagnostics(
  diagnostics: readonly CloudCompatibilityDiagnostic[],
): string {
  return diagnostics
    .map(d => `  [${d.severity}] ${d.code} (${d.subject})\n    ${d.message}\n    → ${d.remedy}`)
    .join('\n\n');
}
