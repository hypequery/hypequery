import { claimedFailure } from './utils/semantic-executor-failure.js';
import { DeploymentSemanticInvocationError, fail, throwIfAborted } from './semantic-invocation-errors.js';
export { DeploymentSemanticInvocationError, toProtocolSemanticInvocationFailure } from './semantic-invocation-errors.js';
import { definedLimits, lowest, tighten } from './utils/semantic-budget-limits.js';
import { missing } from './utils/required-access.js';

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

    // Every ceiling the dataset declared binds here, not just the one that
    // reaches the row budget. `maxDimensions`, `maxMeasures`, and `maxFilters`
    // are published in the contract precisely so a gateway can apply them
    // without loading the authoring package, and a set of ceilings where only
    // one of the four binds is not a set of ceilings.
    const violations = validateSemanticOperation(operation, dataset, datasets, {
      maxRows: budget.maxRows,
      maxOffset: configured.maxOffset,
      maxDimensions: tighten(dataset.limits?.maxDimensions, configured.maxDimensions),
      maxMeasures: tighten(dataset.limits?.maxMeasures, configured.maxMeasures),
      maxFilters: tighten(dataset.limits?.maxFilters, configured.maxFilters),
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
