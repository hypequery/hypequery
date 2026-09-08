/**
 * Semantic invocation beside named-query execution.
 *
 * Decision 0002 requires a dataset or metric call to run the same enforcement
 * sequence a named query does — select the active generation, resolve the
 * target from its validated contract, authenticate, enforce roles and scopes,
 * resolve tenant, apply the most restrictive budget, validate input, execute,
 * then validate and bound the output.
 *
 * Execution itself is injected. This module decides whether a call is allowed
 * and what it is allowed to ask for; `CORE-12` supplies the executor that
 * answers it.
 */

import type {
  ProtocolDatasetContract,
  ProtocolDatasetMetric,
  ProtocolDeploymentContract,
  ProtocolEndpointPolicy,
  ProtocolSemanticInvocation,
  ProtocolSemanticInvocationFailure,
  ProtocolSemanticInvocationFailureCategory,
  ProtocolSemanticInvocationResult,
  ProtocolSemanticQuery,
} from '@hypequery/protocol';
import {
  ProtocolSemanticInvocationError,
  validateProtocolDeploymentContract,
  validateProtocolSemanticInvocation,
  validateProtocolSemanticInvocationResult,
} from '@hypequery/protocol';
import type { DeploymentDataPlanePrincipal } from './data-plane.js';
import {
  validateSemanticOperation,
  type SemanticOperationLimits,
} from './semantic-operation-validation.js';

/** A failure that already carries the public category a caller should see. */
export class DeploymentSemanticInvocationError extends Error {
  readonly category: ProtocolSemanticInvocationFailureCategory;
  readonly code: string;
  readonly path?: string;
  readonly retryable: boolean;
  readonly relist: boolean;

  constructor(
    category: ProtocolSemanticInvocationFailureCategory,
    code: string,
    message: string,
    options: {
      readonly path?: string;
      readonly cause?: unknown;
      readonly retryable?: boolean;
      readonly relist?: boolean;
    } = {},
  ) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = 'DeploymentSemanticInvocationError';
    this.category = category;
    this.code = code;
    this.path = options.path;
    this.retryable = options.retryable ?? false;
    this.relist = options.relist ?? false;
  }
}

function fail(
  category: ProtocolSemanticInvocationFailureCategory,
  code: string,
  message: string,
  options: {
    readonly path?: string;
    readonly cause?: unknown;
    readonly retryable?: boolean;
    readonly relist?: boolean;
  } = {},
): never {
  throw new DeploymentSemanticInvocationError(category, code, message, options);
}

/**
 * Projects a failure onto the portable record.
 *
 * The message is deliberately the one this module produced. A cause is never
 * unwrapped into it, so a provider exception cannot reach a caller.
 */
export function toProtocolSemanticInvocationFailure(
  error: unknown,
  activationRevision?: string,
): ProtocolSemanticInvocationFailure {
  const known = error instanceof DeploymentSemanticInvocationError;
  return Object.freeze({
    kind: 'hypequery-semantic-invocation-failure',
    version: 1,
    category: known ? error.category : 'executor-failed',
    code: known ? error.code : 'HQ_SEMANTIC_EXECUTION_FAILED',
    message: known ? error.message : 'Semantic invocation failed.',
    ...(known && error.path !== undefined ? { path: error.path } : {}),
    retryable: known ? error.retryable : false,
    relist: known ? error.relist : false,
    ...(activationRevision === undefined ? {} : { activationRevision }),
  }) as ProtocolSemanticInvocationFailure;
}

/** The ceilings that survived after every source was applied. */
export interface DeploymentSemanticBudget {
  readonly maxRows: number;
  readonly deadlineMs?: number;
  readonly maxResponseBytes?: number;
}

export interface DeploymentSemanticAuthenticationInput {
  readonly credentials: unknown;
  readonly invocation: ProtocolSemanticInvocation;
  readonly dataset: ProtocolDatasetContract;
  readonly metric?: ProtocolDatasetMetric;
}

export interface DeploymentSemanticTenantInput {
  readonly principal: DeploymentDataPlanePrincipal | null;
  readonly invocation: ProtocolSemanticInvocation;
  readonly dataset: ProtocolDatasetContract;
  readonly metric?: ProtocolDatasetMetric;
}

export interface DeploymentSemanticExecutionInput {
  readonly deployment: ProtocolDeploymentContract;
  readonly dataset: ProtocolDatasetContract;
  readonly metric?: ProtocolDatasetMetric;
  readonly operation: ProtocolSemanticQuery;
  readonly principal: DeploymentDataPlanePrincipal | null;
  /**
   * Resolved by the provider callback. Never a caller-supplied value — the
   * invocation record has no field that could carry one.
   */
  readonly tenant: unknown;
  readonly budget: DeploymentSemanticBudget;
  readonly activationRevision: string;
  readonly signal?: AbortSignal;
}

export interface DeploymentSemanticInvocationRequest {
  /** An unvalidated invocation record; validated before anything else runs. */
  readonly invocation: unknown;
  readonly credentials?: unknown;
  readonly signal?: AbortSignal;
}

export interface DeploymentSemanticDataPlaneOptions {
  readonly deployment: ProtocolDeploymentContract;
  /** The immutable generation this data plane serves. */
  readonly activationRevision: string;
  readonly authenticate?: (
    input: DeploymentSemanticAuthenticationInput,
  ) => Promise<DeploymentDataPlanePrincipal | null>;
  readonly resolveTenant?: (input: DeploymentSemanticTenantInput) => Promise<unknown>;
  readonly execute: (input: DeploymentSemanticExecutionInput) => Promise<unknown>;
  /** Server-side ceilings, applied on top of contract and caller limits. */
  readonly limits?: Partial<SemanticOperationLimits> & {
    readonly deadlineMs?: number;
    readonly maxResponseBytes?: number;
  };
}

export interface DeploymentSemanticDataPlane {
  invoke(request: DeploymentSemanticInvocationRequest): Promise<ProtocolSemanticInvocationResult>;
}

const DEFAULT_LIMITS: SemanticOperationLimits = Object.freeze({
  maxRows: 10_000,
  maxOffset: 10_000,
  maxDimensions: 50,
  maxMeasures: 50,
  maxFilters: 100,
});

const REVISION_PATTERN = /^[0-9a-f]{64}$/;

/**
 * Categories an injected executor may claim for itself.
 *
 * Execution is injected, so the executor is the only component that knows the
 * difference between "this query broke", "this deployment cannot express that",
 * and "this deployment is incoherent". Every category here is one only the
 * executor can determine; the ones it must never claim — `unauthenticated`,
 * `forbidden`, `cancelled`, `stale-activation` — are decided by this module and
 * are deliberately absent.
 */
const EXECUTOR_CATEGORIES: ReadonlySet<string> = new Set([
  'unsupported-capability',
  'budget-exceeded',
  'tenant-required',
  'configuration-invalid',
  'not-found',
  'input-invalid',
  'output-invalid',
  'executor-unavailable',
  'executor-failed',
]);

interface ExecutorFailureShape {
  readonly hypequerySemanticFailure?: unknown;
  readonly category?: unknown;
  readonly code?: unknown;
  readonly message?: unknown;
  readonly retryable?: unknown;
  readonly relist?: unknown;
}

/**
 * The category an executor claimed, when it deliberately claimed one.
 *
 * The `hypequerySemanticFailure` marker, not the shape of the error, is what
 * grants the claim. Allow-listing a `category` string alone would let a
 * provider or library exception that happens to carry a generic one — a
 * `not-found` from an HTTP client, say — put its own message in front of a
 * caller and decide whether the call is retried. This module refuses to unwrap
 * a cause for exactly that reason, and duck-typing would have reopened the door
 * beside it. An error without the marker stays `executor-failed` with the
 * generic message.
 */
function claimedFailure(error: unknown): {
  category: ProtocolSemanticInvocationFailureCategory;
  code: string;
  message: string;
  retryable: boolean;
  relist: boolean;
} | undefined {
  if (typeof error !== 'object' || error === null) return undefined;
  const shape = error as ExecutorFailureShape;
  if (shape.hypequerySemanticFailure !== true) return undefined;
  if (typeof shape.category !== 'string' || !EXECUTOR_CATEGORIES.has(shape.category)) {
    return undefined;
  }
  return {
    category: shape.category as ProtocolSemanticInvocationFailureCategory,
    code: typeof shape.code === 'string' && /^[A-Z][A-Z0-9_]*$/.test(shape.code)
      ? shape.code
      : 'HQ_SEMANTIC_EXECUTION_FAILED',
    message: typeof shape.message === 'string' ? shape.message : 'Semantic execution failed.',
    retryable: shape.retryable === true,
    relist: shape.relist === true,
  };
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) {
    fail('cancelled', 'HQ_SEMANTIC_CANCELLED', 'The invocation was cancelled.');
  }
}

function missing(required: readonly string[], held: readonly string[] | undefined): boolean {
  const available = new Set(held ?? []);
  return required.some(value => !available.has(value));
}

/** Drops explicitly-undefined properties, so a spread cannot erase a default. */
function definedLimits<T extends object>(limits: T | undefined): Partial<T> {
  if (limits === undefined) return {};
  return Object.fromEntries(
    Object.entries(limits).filter(([, value]) => value !== undefined),
  ) as Partial<T>;
}

/** The lowest of every ceiling that applies. A caller can tighten, never widen. */
function lowest(...values: readonly (number | undefined)[]): number | undefined {
  const finite = values.filter((value): value is number => value !== undefined);
  return finite.length === 0 ? undefined : Math.min(...finite);
}

export function createDeploymentSemanticDataPlane(
  options: DeploymentSemanticDataPlaneOptions,
): DeploymentSemanticDataPlane {
  let deployment: ProtocolDeploymentContract;
  try {
    deployment = validateProtocolDeploymentContract(options.deployment);
  } catch (error) {
    throw new DeploymentSemanticInvocationError(
      'configuration-invalid',
      'HQ_SEMANTIC_CONFIGURATION',
      'The semantic data plane requires a valid deployment contract.',
      { cause: error },
    );
  }
  if (!REVISION_PATTERN.test(options.activationRevision)) {
    throw new RangeError('activationRevision must be a lowercase SHA-256 identity');
  }

  const datasets = new Map(deployment.datasets.map(entry => [String(entry.name), entry]));
  // Spreading `options.limits` directly would let an explicitly `undefined`
  // property erase a default ceiling, and an undefined bound compares false
  // against everything. A caller that omits a limit gets the default.
  const configured: SemanticOperationLimits = { ...DEFAULT_LIMITS, ...definedLimits(options.limits) };

  function resolveTarget(operation: ProtocolSemanticQuery): {
    dataset: ProtocolDatasetContract;
    metric?: ProtocolDatasetMetric;
    endpoint: ProtocolEndpointPolicy;
  } {
    const dataset = datasets.get(String(operation.dataset));
    if (dataset === undefined) {
      fail('not-found', 'HQ_SEMANTIC_DATASET_NOT_FOUND', 'The dataset was not found.', {
        path: '$.operation.dataset',
        relist: true,
      });
    }
    const metric = operation.kind === 'metric'
      ? dataset.metrics.find(entry => String(entry.name) === String(operation.metric))
      : undefined;
    if (operation.kind === 'metric' && metric === undefined) {
      fail('not-found', 'HQ_SEMANTIC_METRIC_NOT_FOUND', 'The metric was not found.', {
        path: '$.operation.metric',
        relist: true,
      });
    }
    // An endpoint policy is what publishes a target. Without one the contract
    // describes the dataset but never exposed it, so it is not addressable.
    const endpoint = metric?.endpoint ?? dataset.endpoint;
    if (endpoint === undefined) {
      fail('not-found', 'HQ_SEMANTIC_NOT_PUBLISHED', 'The target is not published.', {
        path: '$.operation',
        relist: true,
      });
    }
    return { dataset, ...(metric === undefined ? {} : { metric }), endpoint };
  }

  async function invoke(
    request: DeploymentSemanticInvocationRequest,
  ): Promise<ProtocolSemanticInvocationResult> {
    throwIfAborted(request.signal);

    let invocation: ProtocolSemanticInvocation;
    try {
      invocation = validateProtocolSemanticInvocation(request.invocation);
    } catch (error) {
      fail('input-invalid', 'HQ_SEMANTIC_INVOCATION_INVALID', 'The invocation record is invalid.', {
        path: error instanceof ProtocolSemanticInvocationError ? error.path : undefined,
        cause: error,
      });
    }

    // Pinning is checked before anything else observable, so a stale caller
    // cannot learn whether a target exists in a generation it may not use.
    if (invocation.activationRevision !== undefined
      && invocation.activationRevision !== options.activationRevision) {
      fail('stale-activation', 'HQ_SEMANTIC_STALE_ACTIVATION',
        'The pinned activation is no longer active.', { retryable: true, relist: true });
    }

    const operation = invocation.operation;
    const { dataset, metric, endpoint } = resolveTarget(operation);

    let principal: DeploymentDataPlanePrincipal | null = null;
    if (endpoint.access.kind === 'authenticated' && !options.authenticate) {
      fail('configuration-invalid', 'HQ_SEMANTIC_CONFIGURATION',
        'An authenticator is required for this target.');
    }
    if (options.authenticate
      && (endpoint.access.kind === 'authenticated' || request.credentials !== undefined)) {
      try {
        principal = await options.authenticate({
          credentials: request.credentials, invocation, dataset, ...(metric ? { metric } : {}),
        });
      } catch (error) {
        fail('unauthenticated', 'HQ_SEMANTIC_UNAUTHENTICATED', 'Authentication failed.', { cause: error });
      }
    }
    throwIfAborted(request.signal);

    if (endpoint.access.kind === 'authenticated') {
      if (!principal) {
        fail('unauthenticated', 'HQ_SEMANTIC_UNAUTHENTICATED', 'Authentication is required.');
      }
      if (missing(endpoint.access.roles, principal.roles)
        || missing(endpoint.access.scopes, principal.scopes)) {
        fail('forbidden', 'HQ_SEMANTIC_FORBIDDEN', 'The principal lacks required access.');
      }
    }

    let tenant: unknown;
    if (endpoint.tenant.kind !== 'not-required') {
      if (!options.resolveTenant) {
        if (endpoint.tenant.kind === 'required') {
          fail('configuration-invalid', 'HQ_SEMANTIC_CONFIGURATION',
            'A tenant resolver is required for this target.');
        }
      } else {
        try {
          tenant = await options.resolveTenant({
            principal, invocation, dataset, ...(metric ? { metric } : {}),
          });
        } catch (error) {
          fail('forbidden', 'HQ_SEMANTIC_FORBIDDEN', 'Tenant resolution failed.', { cause: error });
        }
      }
      if (endpoint.tenant.kind === 'required' && (tenant === undefined || tenant === null)) {
        fail('tenant-required', 'HQ_SEMANTIC_TENANT_REQUIRED', 'Tenant context is required.');
      }
    }
    throwIfAborted(request.signal);

    const budget: DeploymentSemanticBudget = Object.freeze({
      maxRows: lowest(
        invocation.budget?.maxRows,
        endpoint.maxLimit,
        dataset.limits?.maxResultSize,
        configured.maxRows,
      ) ?? configured.maxRows,
      ...(lowest(invocation.budget?.deadlineMs, options.limits?.deadlineMs) === undefined
        ? {}
        : { deadlineMs: lowest(invocation.budget?.deadlineMs, options.limits?.deadlineMs) }),
      ...(lowest(invocation.budget?.maxResponseBytes, options.limits?.maxResponseBytes) === undefined
        ? {}
        : {
            maxResponseBytes: lowest(
              invocation.budget?.maxResponseBytes,
              options.limits?.maxResponseBytes,
            ),
          }),
    });

    const violations = validateSemanticOperation(operation, dataset, datasets, {
      ...configured,
      maxRows: budget.maxRows,
    });
    if (violations.length > 0) {
      const [first] = violations;
      fail('input-invalid', 'HQ_SEMANTIC_INPUT_INVALID', first.message, { path: first.path });
    }
    throwIfAborted(request.signal);

    let output: unknown;
    try {
      output = await options.execute({
        deployment,
        dataset,
        ...(metric === undefined ? {} : { metric }),
        operation,
        principal,
        tenant,
        budget,
        activationRevision: options.activationRevision,
        ...(request.signal === undefined ? {} : { signal: request.signal }),
      });
    } catch (error) {
      if (error instanceof DeploymentSemanticInvocationError) throw error;
      if (request.signal?.aborted) {
        fail('cancelled', 'HQ_SEMANTIC_CANCELLED', 'The invocation was cancelled.', { cause: error });
      }
      const claimed = claimedFailure(error);
      if (claimed !== undefined) {
        fail(claimed.category, claimed.code, claimed.message, {
          cause: error,
          retryable: claimed.retryable,
          relist: claimed.relist,
        });
      }
      fail('executor-failed', 'HQ_SEMANTIC_EXECUTION_FAILED', 'Semantic execution failed.', {
        cause: error,
      });
    }

    // An executor may ignore the signal and resolve anyway. Every other await
    // in this sequence is followed by this check; so is the last one.
    throwIfAborted(request.signal);

    let result: ProtocolSemanticInvocationResult;
    try {
      result = validateProtocolSemanticInvocationResult(output);
    } catch (error) {
      // An executor that returned something unexpected is an internal fault,
      // never a correctable caller error.
      fail('output-invalid', 'HQ_SEMANTIC_OUTPUT_INVALID', 'The executor returned an invalid result.', {
        cause: error,
      });
    }

    // Protocol validation proves the record is well-formed, not that it honored
    // this invocation. The bounds this layer computed are enforced here, so an
    // executor cannot widen them by returning more than it was allowed to.
    if (result.activationRevision !== options.activationRevision) {
      fail('output-invalid', 'HQ_SEMANTIC_OUTPUT_INVALID',
        'The executor served a different activation than the one selected.');
    }
    // The caller's own `limit` is part of what it was allowed to ask for, and
    // validation already proved it is no larger than the budget. An executor
    // that returns more rows than were requested widened the request just as
    // surely as one that exceeded the budget.
    const maxRows = Math.min(budget.maxRows, operation.limit ?? budget.maxRows);
    if (result.data.length > maxRows) {
      fail('budget-exceeded', 'HQ_SEMANTIC_BUDGET_EXCEEDED',
        `The result has ${result.data.length} rows; the effective limit is ${maxRows}.`);
    }
    if (budget.maxResponseBytes !== undefined) {
      const bytes = new TextEncoder().encode(JSON.stringify(result)).byteLength;
      if (bytes > budget.maxResponseBytes) {
        fail('budget-exceeded', 'HQ_SEMANTIC_BUDGET_EXCEEDED',
          `The result is ${bytes} bytes; the effective limit is ${budget.maxResponseBytes}.`);
      }
    }
    return result;
  }

  return Object.freeze({ invoke });
}
