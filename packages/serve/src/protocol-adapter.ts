import {
  validateProtocolDeploymentContract,
  type ProtocolAccessPolicy,
  type ProtocolDeploymentContract,
  type ProtocolEndpointPolicy,
  type ProtocolEndpointTenantPolicy,
  type ProtocolQueryImplementation,
  type ProtocolRuntimeArtifact,
  type ProtocolSchema,
} from '@hypequery/protocol';
import {
  buildProtocolDatasetContract,
  type AnyDatasetInstance,
  type MetricHandle,
} from '@hypequery/datasets';
import type {
  AuthContext,
  AuthStrategy,
  DatasetEntry,
  DatasetsConfig,
  MetricEntry,
  MetricsConfig,
  ServeConfig,
  ServeQueriesMap,
  TenantConfigOverride,
} from './types.js';
import { resolveDatasetEntry } from './semantic/datasets/utils/dataset-entry.js';
import { resolveMetricEntry } from './semantic/datasets/metric-endpoint.js';
import { zodToProtocolSchema } from './protocol-schema-adapter.js';

export interface BuildProtocolDeploymentOptions {
  /** Runtime artifact used for Serve callbacks without an explicit implementation override. */
  readonly runtimeArtifact?: ProtocolRuntimeArtifact & {
    readonly entrypointPrefix?: string;
  };
  /** Per-query implementation overrides for fixed semantic plans or compiled SQL. */
  readonly queryImplementations?: Readonly<Record<string, ProtocolQueryImplementation>>;
  /** Schema overrides for Zod constructs outside the portable RFC 0004 subset. */
  readonly querySchemas?: Readonly<Record<string, {
    readonly input?: ProtocolSchema;
    readonly output?: ProtocolSchema;
  }>>;
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
  authNullIsPublic: boolean,
): ProtocolAccessPolicy {
  const roles = [...new Set(local.requiredRoles ?? [])].sort();
  const scopes = [...new Set(local.requiredScopes ?? [])].sort();
  if (roles.length > 0 || scopes.length > 0) {
    return { kind: 'authenticated', roles, scopes };
  }
  if (local.requiresAuth === false || (authNullIsPublic && local.auth === null)) {
    return { kind: 'public' };
  }
  if (local.requiresAuth === true || local.auth != null || hasGlobalAuth(globalAuth)) {
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
  authNullIsPublic = false,
): ProtocolEndpointPolicy {
  const cacheTtlMs = local.cacheTtlMs ?? local.cache ?? undefined;
  return {
    access: accessPolicy(local, globalAuth, authNullIsPublic),
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

function metricHandle(entry: MetricEntry<AuthContext>): MetricHandle {
  return resolveMetricEntry(entry).metric;
}

function metricDataset(metric: MetricHandle): AnyDatasetInstance {
  return metric.__type === 'grained_metric_ref' ? metric.metric.dataset : metric.dataset;
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

function queryImplementation(
  name: string,
  options: BuildProtocolDeploymentOptions,
): ProtocolQueryImplementation {
  const override = options.queryImplementations?.[name];
  if (override) return override;
  if (!options.runtimeArtifact) {
    throw new Error(
      `Serve query "${name}" needs runtimeArtifact or an explicit queryImplementations override.`,
    );
  }
  const prefix = options.runtimeArtifact.entrypointPrefix ?? 'queries';
  return {
    kind: 'runtime-reference',
    runtime: options.runtimeArtifact.runtime,
    artifactSha256: options.runtimeArtifact.artifactSha256,
    entrypoint: `${prefix}.${name}`,
  } as unknown as ProtocolQueryImplementation;
}

function runtimeArtifacts(
  implementations: readonly ProtocolQueryImplementation[],
  configured?: ProtocolRuntimeArtifact,
): readonly ProtocolRuntimeArtifact[] {
  const artifacts = new Map<string, ProtocolRuntimeArtifact>();
  if (configured) {
    artifacts.set(configured.artifactSha256, {
      runtime: configured.runtime,
      artifactSha256: configured.artifactSha256,
    });
  }
  for (const implementation of implementations) {
    if (implementation.kind !== 'runtime-reference') continue;
    const existing = artifacts.get(implementation.artifactSha256);
    if (existing && existing.runtime !== implementation.runtime) {
      throw new Error(`Runtime artifact ${implementation.artifactSha256} has conflicting runtimes.`);
    }
    artifacts.set(implementation.artifactSha256, {
      runtime: implementation.runtime,
      artifactSha256: implementation.artifactSha256,
    });
  }
  return [...artifacts.values()].sort((left, right) =>
    left.artifactSha256.localeCompare(right.artifactSha256));
}

/**
 * Converts an existing Serve configuration and its Dataset/metric definitions
 * into the strict, immutable protocol deployment contract.
 */
export function buildProtocolDeploymentContract(
  config: ServeConfig<any, any, any, any, any>,
  options: BuildProtocolDeploymentOptions = {},
): ProtocolDeploymentContract {
  const serveConfig = config as unknown as AnyServeConfig;
  const basePath = serveConfig.basePath ?? '/api/analytics';
  const datasetsPath = serveConfig.semanticPaths?.datasets ?? '/datasets';
  const metricsPath = serveConfig.semanticPaths?.metrics ?? '/metrics';
  const datasets = new Map<string, AnyDatasetInstance>();
  const datasetEndpoints = new Map<string, ProtocolEndpointPolicy>();
  const metricHandles: Record<string, MetricHandle> = {};
  const metricEndpoints: Record<string, ProtocolEndpointPolicy> = {};

  for (const [exposedName, entry] of Object.entries(serveConfig.datasets ?? {})) {
    const resolved = resolveDatasetEntry(entry as DatasetEntry<AuthContext>);
    collectDataset(datasets, resolved.dataset);
    if (datasetEndpoints.has(resolved.dataset.name)) {
      throw new Error(`Dataset "${resolved.dataset.name}" is exposed more than once.`);
    }
    datasetEndpoints.set(resolved.dataset.name, endpointPolicy(
      resolved,
      serveConfig.auth,
      serveConfig.tenant,
      normalizePath(basePath, datasetsPath, exposedName, 'query'),
      resolved.dataset.limits?.maxResultSize ?? 1_000,
      true,
    ));
  }

  for (const [exposedName, entry] of Object.entries(serveConfig.metrics ?? {})) {
    const resolved = resolveMetricEntry(entry as MetricEntry<AuthContext>);
    const metric = metricHandle(entry as MetricEntry<AuthContext>);
    const dataset = metricDataset(metric);
    collectDataset(datasets, dataset);
    metricHandles[exposedName] = metric;
    metricEndpoints[exposedName] = endpointPolicy(
      resolved,
      serveConfig.auth,
      serveConfig.tenant,
      normalizePath(basePath, metricsPath, exposedName),
      resolved.maxLimit ?? dataset.limits?.maxResultSize ?? 1_000,
      true,
    );
  }

  const datasetContracts = [...datasets.values()]
    .map(dataset => buildProtocolDatasetContract(dataset, {
      metrics: metricHandles,
      metricEndpoints,
      ...(datasetEndpoints.get(dataset.name) !== undefined
        ? { endpoint: datasetEndpoints.get(dataset.name) }
        : {}),
    }))
    .sort((left, right) => left.name.localeCompare(right.name));

  const implementations: ProtocolQueryImplementation[] = [];
  const queries = Object.entries(serveConfig.queries ?? {}).map(([name, query]) => {
    const implementation = queryImplementation(name, options);
    implementations.push(implementation);
    const schemaOverride = options.querySchemas?.[name];
    return {
      name,
      input: schemaOverride?.input ?? zodToProtocolSchema(query.inputSchema, `queries.${name}.input`),
      output: schemaOverride?.output ?? zodToProtocolSchema(query.outputSchema, `queries.${name}.output`),
      implementation,
      endpoint: {
        ...endpointPolicy(
          query,
          serveConfig.auth,
          serveConfig.tenant,
          normalizePath(basePath, 'queries', name),
        ),
        method: query.method ?? 'GET',
      },
      ...(query.summary !== undefined ? { summary: query.summary } : {}),
      ...(query.description !== undefined ? { description: query.description } : {}),
      tags: [...new Set(query.tags ?? [])].sort(),
    };
  }).sort((left, right) => left.name.localeCompare(right.name));

  return validateProtocolDeploymentContract({
    kind: 'hypequery-deployment',
    version: 1,
    datasets: datasetContracts,
    queries,
    artifacts: runtimeArtifacts(implementations, options.runtimeArtifact),
  });
}
