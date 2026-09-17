import type {
  ProtocolAccessPolicy,
  ProtocolDatasetOnlyContract,
  ProtocolEndpointPolicy,
  ProtocolEndpointTenantPolicy,
} from '@hypequery/protocol';
import {
  buildProtocolDatasetOnlyContract,
  type AnyDatasetInstance,
} from '@hypequery/datasets';
import {
  analyzeCloudCompatibility,
  analyzeLocalOnlyDeclarations,
  formatCloudCompatibilityDiagnostics,
  type CloudCompatibilityDiagnostic,
  type CloudCompatibilitySurface,
} from './cloud-compatibility.js';
import type {
  AuthContext,
  AuthStrategy,
  DatasetEntry,
  DatasetsConfig,
  MetricsConfig,
  ServeConfig,
  ServeQueriesMap,
  TenantConfigOverride,
} from './types.js';
import { resolveDatasetEntry } from './semantic/datasets/utils/dataset-entry.js';
import { resolveLocalAuthRequirement } from './auth-requirement.js';

export interface BuildProtocolDeploymentOptions {
  /**
   * Receives every managed-execution diagnostic, including ones that do not
   * block the build. Without it, warnings are discarded and only errors surface.
   */
  readonly onCloudDiagnostic?: (diagnostic: CloudCompatibilityDiagnostic) => void;
  /**
   * Downgrades managed-execution errors to warnings. The author is asserting
   * they know the deployed behaviour differs from local.
   */
  readonly allowUnsupportedConfig?: boolean;
}

function reportCloudCompatibility(
  config: ServeConfig<any, any, any, any, any>,
  options: BuildProtocolDeploymentOptions,
  extra: readonly CloudCompatibilityDiagnostic[] = [],
  surface: CloudCompatibilitySurface = 'all',
): void {
  const diagnostics = [...analyzeCloudCompatibility(config, { surface }), ...extra];
  if (diagnostics.length === 0) return;
  for (const diagnostic of diagnostics) options.onCloudDiagnostic?.(diagnostic);
  if (options.allowUnsupportedConfig) return;

  const blocking = diagnostics.filter(diagnostic => diagnostic.severity === 'error');
  if (blocking.length === 0) return;
  throw new Error(
    'This Serve configuration would behave differently under managed execution:\n\n'
    + `${formatCloudCompatibilityDiagnostics(blocking)}\n\n`
    + 'Resolve these, or pass allowUnsupportedConfig to deploy anyway.',
  );
}

type AnyServeConfig = ServeConfig<
  Record<string, unknown>,
  AuthContext,
  ServeQueriesMap<Record<string, unknown>, AuthContext>,
  MetricsConfig<AuthContext>,
  DatasetsConfig<AuthContext>
>;

function normalizePath(...parts: string[]): string {
  const joined = parts
    .filter(Boolean)
    .map((part, index) => index === 0 ? part.replace(/\/+$/g, '') : part.replace(/^\/+|\/+$/g, ''))
    .filter(Boolean)
    .join('/');
  return `/${joined.replace(/^\/+/, '')}`.replace(/\/{2,}/g, '/');
}

function hasGlobalAuth(auth: AuthStrategy<AuthContext> | AuthStrategy<AuthContext>[] | undefined): boolean {
  return Array.isArray(auth) ? auth.length > 0 : auth !== undefined;
}

function accessPolicy(
  local: {
    readonly auth?: AuthStrategy<AuthContext> | null;
    readonly requiresAuth?: boolean;
    readonly requiredRoles?: readonly string[];
    readonly requiredScopes?: readonly string[];
  },
  globalAuth: AnyServeConfig['auth'],
): ProtocolAccessPolicy {
  const roles = [...new Set(local.requiredRoles ?? [])].sort();
  const scopes = [...new Set(local.requiredScopes ?? [])].sort();
  const localRequirement = resolveLocalAuthRequirement({
    ...local,
    requiredRoles: roles,
    requiredScopes: scopes,
  });
  if (localRequirement ?? hasGlobalAuth(globalAuth)) {
    return { kind: 'authenticated', roles, scopes };
  }
  return { kind: 'public' };
}

function endpointPolicy(
  local: {
    readonly auth?: AuthStrategy<AuthContext> | null;
    readonly requiresAuth?: boolean;
    readonly requiredRoles?: readonly string[];
    readonly requiredScopes?: readonly string[];
    readonly cache?: number | null;
    readonly cacheTtlMs?: number | null;
    readonly maxLimit?: number;
    readonly tenant?: TenantConfigOverride<AuthContext>;
  },
  globalAuth: AnyServeConfig['auth'],
  globalTenant: AnyServeConfig['tenant'],
  path: string,
  defaultMaxLimit?: number,
): ProtocolEndpointPolicy {
  const cacheTtlMs = local.cacheTtlMs ?? local.cache ?? undefined;
  return {
    access: accessPolicy(local, globalAuth),
    tenant: endpointTenantPolicy(local.tenant, globalTenant),
    ...(typeof cacheTtlMs === 'number' && cacheTtlMs > 0 ? { cacheTtlMs } : {}),
    ...((local.maxLimit ?? defaultMaxLimit) !== undefined
      ? { maxLimit: local.maxLimit ?? defaultMaxLimit }
      : {}),
    path,
  };
}

function endpointTenantPolicy(
  local: TenantConfigOverride<AuthContext> | undefined,
  global: AnyServeConfig['tenant'],
): ProtocolEndpointTenantPolicy {
  if (local === undefined && global === undefined) return { kind: 'not-required' };
  const effective = { ...(global ?? {}), ...(local ?? {}) };
  return {
    kind: effective.required === false ? 'optional' : 'required',
    mode: effective.mode ?? 'manual',
    ...(effective.column !== undefined ? { column: effective.column } : {}),
  };
}

function collectDataset(
  datasets: Map<string, AnyDatasetInstance>,
  dataset: AnyDatasetInstance,
): void {
  const existing = datasets.get(dataset.name);
  if (existing && existing !== dataset) {
    throw new Error(`Multiple Dataset definitions use the protocol name "${dataset.name}".`);
  }
  if (existing) return;
  datasets.set(dataset.name, dataset);
  for (const relationship of Object.values(dataset.relationships)) {
    collectDataset(datasets, relationship.target() as AnyDatasetInstance);
  }
}

interface PublishedDatasets {
  readonly datasets: Map<string, AnyDatasetInstance>;
  readonly endpoints: Map<string, ProtocolEndpointPolicy>;
}

/** Datasets exposed under `datasets`, plus every dataset they reach by relationship. */
function collectPublishedDatasets(serveConfig: AnyServeConfig, basePath: string): PublishedDatasets {
  const datasetsPath = serveConfig.semanticPaths?.datasets ?? '/datasets';
  const datasets = new Map<string, AnyDatasetInstance>();
  const endpoints = new Map<string, ProtocolEndpointPolicy>();
  for (const [exposedName, entry] of Object.entries(serveConfig.datasets ?? {})) {
    const resolved = resolveDatasetEntry(entry as DatasetEntry<AuthContext>);
    collectDataset(datasets, resolved.dataset);
    if (endpoints.has(resolved.dataset.name)) {
      throw new Error(`Dataset "${resolved.dataset.name}" is exposed more than once.`);
    }
    endpoints.set(resolved.dataset.name, endpointPolicy(
      resolved,
      serveConfig.auth,
      serveConfig.tenant,
      normalizePath(basePath, datasetsPath, exposedName, 'query'),
      resolved.dataset.limits?.maxResultSize ?? 1_000,
    ));
  }
  return { datasets, endpoints };
}

/**
 * Converts an existing Serve configuration and its Dataset definitions into the
 * dataset-only Cloud contract.
 *
 * Named queries and standalone metrics are deliberately never copied: there is
 * no field on this wire that could carry them, so a build cannot leak one by
 * omission. They are reported instead, through the same diagnostic channel as
 * every other local/deployed difference.
 */
export function buildProtocolDatasetOnlyDeploymentContract(
  config: ServeConfig<any, any, any, any, any>,
  options: BuildProtocolDeploymentOptions = {},
): ProtocolDatasetOnlyContract {
  const serveConfig = config as unknown as AnyServeConfig;
  const basePath = serveConfig.basePath ?? '/api/analytics';
  const { datasets, endpoints } = collectPublishedDatasets(serveConfig, basePath);
  reportCloudCompatibility(
    config,
    options,
    analyzeLocalOnlyDeclarations(config, new Set(datasets.keys())),
    'datasets',
  );
  return buildProtocolDatasetOnlyContract(
    [...datasets.values()].sort((left, right) => left.name.localeCompare(right.name)),
    { endpoints: Object.fromEntries(endpoints) },
  );
}
