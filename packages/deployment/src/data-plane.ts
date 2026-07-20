import type {
  ProtocolDeploymentContract,
  ProtocolNamedQueryContract,
  ProtocolQueryImplementation,
  ProtocolSchemaValueParser,
} from '@hypequery/protocol';
import {
  createProtocolSchemaValueParser,
  ProtocolSchemaValueError,
  ProtocolValueError,
  validateProtocolDeploymentContract,
} from '@hypequery/protocol';
import {
  resolveDeploymentDataPlaneLimits,
  type DeploymentDataPlaneLimits,
} from './data-plane-limits.js';

type DataRecord = Record<string, unknown>;

export type DeploymentDataPlaneErrorCode =
  | 'HQ_DATA_PLANE_CONFIGURATION'
  | 'HQ_DATA_PLANE_ROUTE_NOT_FOUND'
  | 'HQ_DATA_PLANE_METHOD_NOT_ALLOWED'
  | 'HQ_DATA_PLANE_UNAUTHENTICATED'
  | 'HQ_DATA_PLANE_FORBIDDEN'
  | 'HQ_DATA_PLANE_TENANT_REQUIRED'
  | 'HQ_DATA_PLANE_INPUT_INVALID'
  | 'HQ_DATA_PLANE_OUTPUT_INVALID'
  | 'HQ_DATA_PLANE_EXECUTOR_UNAVAILABLE'
  | 'HQ_DATA_PLANE_EXECUTION_FAILED'
  | 'HQ_DATA_PLANE_ABORTED';

export class DeploymentDataPlaneError extends Error {
  readonly code: DeploymentDataPlaneErrorCode;
  readonly path?: string;

  constructor(
    code: DeploymentDataPlaneErrorCode,
    message: string,
    options: { readonly path?: string; readonly cause?: unknown } = {},
  ) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = 'DeploymentDataPlaneError';
    this.code = code;
    this.path = options.path;
  }
}

export interface DeploymentDataPlanePrincipal {
  readonly subject?: string;
  readonly roles?: readonly string[];
  readonly scopes?: readonly string[];
  readonly claims?: Readonly<Record<string, unknown>>;
}

export interface DeploymentDataPlaneRequest {
  readonly method: string;
  readonly path: string;
  readonly input?: unknown;
  readonly query?: Readonly<Record<string, string | readonly string[]>>;
  readonly headers?: Readonly<Record<string, string>>;
  readonly credentials?: unknown;
  readonly signal?: AbortSignal;
}

export type DeploymentDataPlaneJsonRequest = Omit<DeploymentDataPlaneRequest, 'input'> & {
  readonly input?: string | Uint8Array;
};

export interface DeploymentDataPlaneAuthenticationInput {
  readonly credentials: unknown;
  readonly request: DeploymentDataPlaneRequest;
  readonly query: ProtocolNamedQueryContract;
}

export interface DeploymentDataPlaneTenantInput {
  readonly principal: DeploymentDataPlanePrincipal | null;
  readonly request: DeploymentDataPlaneRequest;
  readonly query: ProtocolNamedQueryContract;
}

export interface DeploymentDataPlaneExecutionInput {
  readonly query: ProtocolNamedQueryContract;
  readonly input: unknown;
  readonly principal: DeploymentDataPlanePrincipal | null;
  readonly tenant: unknown;
  readonly request: DeploymentDataPlaneRequest;
  readonly signal?: AbortSignal;
}

export interface DeploymentSemanticPlanExecutionInput extends DeploymentDataPlaneExecutionInput {
  readonly implementation: Extract<ProtocolQueryImplementation, { readonly kind: 'semantic-plan' }>;
  readonly deployment: ProtocolDeploymentContract;
}

export interface DeploymentCompiledSqlExecutionInput extends DeploymentDataPlaneExecutionInput {
  readonly implementation: Extract<ProtocolQueryImplementation, { readonly kind: 'compiled-sql' }>;
  readonly parameters: Readonly<Record<string, unknown>>;
}

export interface DeploymentRuntimeReferenceExecutionInput extends DeploymentDataPlaneExecutionInput {
  readonly implementation: Extract<ProtocolQueryImplementation, { readonly kind: 'runtime-reference' }>;
}

export interface DeploymentDataPlaneResult {
  readonly query: string;
  readonly output: unknown;
  readonly cacheTtlMs?: number;
}

export interface DeploymentDataPlane {
  execute(request: DeploymentDataPlaneRequest): Promise<DeploymentDataPlaneResult>;
  executeJson(request: DeploymentDataPlaneJsonRequest): Promise<DeploymentDataPlaneResult>;
}

export interface DeploymentDataPlaneOptions {
  readonly deployment: ProtocolDeploymentContract;
  readonly authenticate?: (
    input: DeploymentDataPlaneAuthenticationInput,
  ) => Promise<DeploymentDataPlanePrincipal | null>;
  readonly resolveTenant?: (input: DeploymentDataPlaneTenantInput) => Promise<unknown>;
  readonly executeSemanticPlan?: (input: DeploymentSemanticPlanExecutionInput) => Promise<unknown>;
  readonly executeCompiledSql?: (input: DeploymentCompiledSqlExecutionInput) => Promise<unknown>;
  readonly executeRuntimeReference?: (
    input: DeploymentRuntimeReferenceExecutionInput,
  ) => Promise<unknown>;
  readonly limits?: Partial<DeploymentDataPlaneLimits>;
}

function dataPlaneError(
  code: DeploymentDataPlaneErrorCode,
  message: string,
  cause?: unknown,
  path?: string,
): DeploymentDataPlaneError {
  return new DeploymentDataPlaneError(code, message, { cause, path });
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) {
    throw dataPlaneError('HQ_DATA_PLANE_ABORTED', 'The data-plane request was aborted.', signal.reason);
  }
}

function frozenRecord(entries: Record<string, unknown>): DataRecord {
  return Object.freeze(Object.assign(Object.create(null), entries)) as DataRecord;
}

function valueAtPath(input: unknown, path: string): unknown {
  let value = input;
  for (const segment of path.split('.')) {
    if (typeof value !== 'object' || value === null || Array.isArray(value)
      || !Object.hasOwn(value, segment)) return undefined;
    value = (value as DataRecord)[segment];
  }
  return value;
}

function sqlParameters(
  query: ProtocolNamedQueryContract,
  input: unknown,
  tenant: unknown,
): Readonly<Record<string, unknown>> {
  if (query.implementation.kind !== 'compiled-sql') return Object.freeze({});
  const values: Record<string, unknown> = Object.create(null);
  for (const parameter of query.implementation.parameters) {
    const value = parameter.source.kind === 'tenant'
      ? tenant
      : valueAtPath(input, parameter.source.path);
    if (value === undefined) {
      throw dataPlaneError(
        'HQ_DATA_PLANE_INPUT_INVALID',
        'A required compiled SQL binding is missing.',
        undefined,
        parameter.source.kind === 'input' ? `$.${parameter.source.path}` : '$.tenant',
      );
    }
    values[parameter.name] = value;
  }
  return frozenRecord(values);
}

interface QueryRoute {
  readonly query: ProtocolNamedQueryContract;
  readonly input: ProtocolSchemaValueParser;
  readonly output: ProtocolSchemaValueParser;
}

function routeTable(
  deployment: ProtocolDeploymentContract,
  limits: Readonly<DeploymentDataPlaneLimits>,
): ReadonlyMap<string, QueryRoute> {
  const routes = new Map<string, QueryRoute>();
  for (const query of deployment.queries) {
    routes.set(`${query.endpoint.method}\0${query.endpoint.path}`, Object.freeze({
      query,
      input: createProtocolSchemaValueParser(query.input, { limits }),
      output: createProtocolSchemaValueParser(query.output, { limits }),
    }));
  }
  return routes;
}

function missing(values: readonly string[], actual: readonly string[] | undefined): readonly string[] {
  const available = new Set(actual ?? []);
  return values.filter(value => !available.has(value));
}

export function createDeploymentDataPlane(options: DeploymentDataPlaneOptions): DeploymentDataPlane {
  let deployment: ProtocolDeploymentContract;
  try {
    deployment = validateProtocolDeploymentContract(options.deployment);
  } catch (error) {
    throw dataPlaneError(
      'HQ_DATA_PLANE_CONFIGURATION',
      'The deployment data plane requires a valid deployment contract.',
      error,
    );
  }
  const limits = resolveDeploymentDataPlaneLimits(options.limits);
  const routes = routeTable(deployment, limits);
  const paths = new Set(deployment.queries.map(query => query.endpoint.path));

  async function execute(
    request: DeploymentDataPlaneRequest,
    json: boolean,
  ): Promise<DeploymentDataPlaneResult> {
    throwIfAborted(request.signal);
    const route = routes.get(`${request.method}\0${request.path}`);
    if (!route) {
      if (paths.has(request.path)) {
        throw dataPlaneError(
          'HQ_DATA_PLANE_METHOD_NOT_ALLOWED',
          'The deployment route does not support this method.',
        );
      }
      throw dataPlaneError('HQ_DATA_PLANE_ROUTE_NOT_FOUND', 'The deployment route was not found.');
    }
    const { query } = route;

    let principal: DeploymentDataPlanePrincipal | null = null;
    if (query.endpoint.access.kind === 'authenticated' && !options.authenticate) {
      throw dataPlaneError(
        'HQ_DATA_PLANE_CONFIGURATION',
        'An authenticator is required for this deployment route.',
      );
    }
    if (options.authenticate
      && (query.endpoint.access.kind === 'authenticated' || request.credentials !== undefined)) {
      try {
        principal = await options.authenticate({ credentials: request.credentials, request, query });
      } catch (error) {
        throw dataPlaneError('HQ_DATA_PLANE_UNAUTHENTICATED', 'Authentication failed.', error);
      }
    }
    throwIfAborted(request.signal);
    if (query.endpoint.access.kind === 'authenticated') {
      if (!principal) {
        throw dataPlaneError('HQ_DATA_PLANE_UNAUTHENTICATED', 'Authentication is required.');
      }
      if (missing(query.endpoint.access.roles, principal.roles).length > 0
        || missing(query.endpoint.access.scopes, principal.scopes).length > 0) {
        throw dataPlaneError('HQ_DATA_PLANE_FORBIDDEN', 'The principal lacks required access.');
      }
    }

    let tenant: unknown;
    if (query.endpoint.tenant.kind !== 'not-required') {
      if (!options.resolveTenant) {
        if (query.endpoint.tenant.kind === 'required') {
          throw dataPlaneError(
            'HQ_DATA_PLANE_CONFIGURATION',
            'A tenant resolver is required for this deployment route.',
          );
        }
      } else {
        try {
          tenant = await options.resolveTenant({ principal, request, query });
        } catch (error) {
          throw dataPlaneError('HQ_DATA_PLANE_FORBIDDEN', 'Tenant resolution failed.', error);
        }
      }
      if (query.endpoint.tenant.kind === 'required' && (tenant === undefined || tenant === null)) {
        throw dataPlaneError('HQ_DATA_PLANE_TENANT_REQUIRED', 'Tenant context is required.');
      }
    }
    throwIfAborted(request.signal);

    let input: unknown;
    try {
      if (json && request.input !== undefined) {
        if (typeof route.input.parseJson !== 'function') throw dataPlaneError(
          'HQ_DATA_PLANE_CONFIGURATION',
          'The route input parser does not support JSON request bodies.',
        );
        input = route.input.parseJson(request.input as string | Uint8Array);
      } else {
        input = route.input.parse(request.input);
      }
    } catch (error) {
      if (error instanceof ProtocolSchemaValueError || error instanceof ProtocolValueError) {
        throw dataPlaneError(
          'HQ_DATA_PLANE_INPUT_INVALID',
          'The request input does not match the deployment schema.',
          error,
          error.path,
        );
      }
      throw error;
    }

    const common = { query, input, principal, tenant, request, signal: request.signal } as const;
    let output: unknown;
    try {
      switch (query.implementation.kind) {
        case 'semantic-plan':
          if (!options.executeSemanticPlan) throw dataPlaneError(
            'HQ_DATA_PLANE_EXECUTOR_UNAVAILABLE',
            'No semantic-plan executor is configured.',
          );
          output = await options.executeSemanticPlan({
            ...common,
            implementation: query.implementation,
            deployment,
          });
          break;
        case 'compiled-sql':
          if (!options.executeCompiledSql) throw dataPlaneError(
            'HQ_DATA_PLANE_EXECUTOR_UNAVAILABLE',
            'No compiled SQL executor is configured.',
          );
          output = await options.executeCompiledSql({
            ...common,
            implementation: query.implementation,
            parameters: sqlParameters(query, input, tenant),
          });
          break;
        case 'runtime-reference':
          if (!options.executeRuntimeReference) throw dataPlaneError(
            'HQ_DATA_PLANE_EXECUTOR_UNAVAILABLE',
            'No runtime-reference executor is configured.',
          );
          output = await options.executeRuntimeReference({
            ...common,
            implementation: query.implementation,
          });
          break;
      }
    } catch (error) {
      if (error instanceof DeploymentDataPlaneError) throw error;
      if (request.signal?.aborted) {
        throw dataPlaneError('HQ_DATA_PLANE_ABORTED', 'The data-plane request was aborted.', error);
      }
      throw dataPlaneError('HQ_DATA_PLANE_EXECUTION_FAILED', 'Deployment query execution failed.', error);
    }

    try {
      output = route.output.parse(output);
    } catch (error) {
      if (error instanceof ProtocolSchemaValueError) {
        throw dataPlaneError(
          'HQ_DATA_PLANE_OUTPUT_INVALID',
          'The query output does not match the deployment schema.',
          error,
          error.path,
        );
      }
      throw error;
    }
    const publicCacheTtlMs = query.endpoint.access.kind === 'public'
      && query.endpoint.tenant.kind === 'not-required'
      && principal === null
      ? query.endpoint.cacheTtlMs
      : undefined;
    return Object.freeze({
      query: query.name,
      output,
      ...(publicCacheTtlMs === undefined ? {} : { cacheTtlMs: publicCacheTtlMs }),
    });
  }

  return Object.freeze({
    execute: (request: DeploymentDataPlaneRequest) => execute(request, false),
    executeJson: (request: DeploymentDataPlaneJsonRequest) => execute(request, true),
  });
}
