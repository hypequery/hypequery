import { PortableExecutionUnsupportedError, PortableExecutionTenantError } from './portable-execution-errors.js';
export { PortableExecutionUnsupportedError, PortableExecutionBudgetError, PortableExecutionTenantError } from './portable-execution-errors.js';
import { tenantRuntime, semanticQuery } from './utils/portable-semantic-query.js';
import { bounded } from './utils/portable-result-budget.js';
import { withDeadline } from './utils/portable-execution-deadline.js';

/**
 * Portable native execution of a semantic invocation.
 *
 * Decision 0005 chose this over a supervised runtime binding: resolve the
 * dataset from the validated active contract, rebuild its catalog
 * with `rehydrateProtocolDatasets`, and plan the query with the existing
 * semantic planner. No customer module is loaded and no isolated runtime is
 * required, so customer code only ever runs on the author's machine at deploy
 * time.
 *
 * The input is typed structurally rather than against
 * `@hypequery/deployment`'s execution input, so this package stays a sibling of
 * that one. A caller wires the returned function into the data plane's injected
 * `execute` slot.
 */

import type {
  ProtocolDeploymentDatasetAnyVersion,
  ProtocolEventOperation,
  ProtocolExpression,
  ProtocolSemanticInvocationResult,
  ProtocolSemanticQuery,
} from '@hypequery/protocol';
import { prepareEventOperation } from './event-operations.js';
import { eventConstraintFilters, eventOperationSpec } from './utils/event-operation-spec.js';
import { createDatasetClient } from './executor.js';
import type { DatasetCompilation, DatasetCompilationDescription } from './dataset-compilation.js';
import type { ExecutionContext } from './types.js';
import {
  rehydrateProtocolDatasets,
  UNSUPPORTED_CONTRACT_REASONS,
  UnsupportedContractFeatureError,
  type RehydratedDataset,
} from './protocol-rehydrate.js';
import { toQueryBuilderFactory, type QueryBuilderFactoryInput } from './query-builder-protocol.js';
/** Ceilings the data plane already reduced to the most restrictive value. */
export interface PortableSemanticBudget {
  readonly maxRows: number;
  readonly deadlineMs?: number;
  readonly maxResponseBytes?: number;
}

/**
 * Structurally compatible with the deployment data plane's execution input.
 * Only the fields portable execution reads are declared, so the two packages
 * stay independent.
 */
export interface PortableSemanticExecutionInput {
  readonly deployment: { readonly datasets: readonly ProtocolDeploymentDatasetAnyVersion[] };
  readonly dataset: ProtocolDeploymentDatasetAnyVersion;
  readonly operation: ProtocolSemanticQuery;
  /** Resolved by the provider callback; never caller-supplied. */
  readonly tenant: unknown;
  readonly budget: PortableSemanticBudget;
  /** Identifies the immutable generation, and keys the rebuilt catalog. */
  readonly activationRevision: string;
  readonly signal?: AbortSignal;
}

/**
 * The data plane's RFC 0027 execution input: the same fields, with a funnel
 * operation and, apart from it, the provider's enforced constraints.
 */
export interface PortableEventExecutionInput extends Omit<PortableSemanticExecutionInput, 'operation'> {
  readonly operation: ProtocolEventOperation;
  /** RFC 0019 enforced constraints, applied to the scan as trusted context. */
  readonly constraints?: readonly ProtocolExpression[];
}

export interface PortableSemanticExecutorOptions {
  readonly queryBuilder: QueryBuilderFactoryInput;
  /**
   * Rebuilt catalogs are memoized by activation revision. A release is
   * immutable and content-addressed, so the revision is an exact key with no
   * invalidation problem. Only the most recent generation is kept here;
   * `CLOUD-09` owns the bounded multi-release cache.
   */
  readonly cacheRebuiltCatalogs?: boolean;
  /**
   * Clock that resolves `inDateRange` filters (RFC 0029), read once per call.
   * Defaults to the system clock. The request carries no clock: a caller
   * never decides what "today" is.
   */
  readonly now?: () => Date;
}

type Registry = Readonly<Record<string, RehydratedDataset>>;

export interface PortableDatasetCompilation extends DatasetCompilation {
  readonly activationRevision: string;
  describe(): DatasetCompilationDescription & { readonly activationRevision: string };
  toJSON(): DatasetCompilationDescription & { readonly activationRevision: string };
}

export interface PortableSemanticRuntime {
  /** Trusted preview: the same catalog, tenant mapping and budgets as execute.
   * The caller must enforce deployment access before calling either operation.
   */
  compile(input: PortableSemanticExecutionInput): PortableDatasetCompilation;
  execute(input: PortableSemanticExecutionInput): Promise<ProtocolSemanticInvocationResult>;
  /** RFC 0027 funnels; wire into the data plane's `executeEventOperation`. */
  executeEventOperation(input: PortableEventExecutionInput): Promise<ProtocolSemanticInvocationResult>;
}

/** Shared portable runtime for provider-side authoring preview and execution. */
export function createPortableSemanticRuntime(
  options: PortableSemanticExecutorOptions,
): PortableSemanticRuntime {
  const client = createDatasetClient({
    queryBuilder: options.queryBuilder,
    ...(options.now === undefined ? {} : { now: options.now }),
  });
  let memo: { revision: string; registry: Registry } | undefined;

  function registryFor(input: PortableSemanticExecutionInput): Registry {
    if (options.cacheRebuiltCatalogs !== false && memo?.revision === input.activationRevision) {
      return memo.registry;
    }
    let registry: Registry;
    try {
      registry = rehydrateProtocolDatasets(input.deployment.datasets);
    } catch (error) {
      if (error instanceof UnsupportedContractFeatureError) {
        // Decision 0005: a surface portable execution cannot reproduce is
        // excluded from it, never approximated.
        throw new PortableExecutionUnsupportedError(error.message, {
          cause: error,
          ...(error.reason === undefined ? {} : { reason: error.reason }),
        });
      }
      throw error;
    }
    memo = { revision: input.activationRevision, registry };
    return registry;
  }

  function resolveTarget(input: Omit<PortableSemanticExecutionInput, 'operation'>) {
    const registry = registryFor(input as PortableSemanticExecutionInput);
    const rebuilt = registry[String(input.dataset.name)];
    if (rebuilt === undefined) {
      throw new PortableExecutionUnsupportedError(
        `Dataset "${String(input.dataset.name)}" is not part of the activated contract.`,
        { reason: UNSUPPORTED_CONTRACT_REASONS.datasetNotActivated },
      );
    }
    const target = rebuilt;
    const tenant = tenantRuntime(input.tenant);
    // A tenant with nothing to scope by is the one failure that is silent
    // everywhere else: the runtime accepts it, the planner emits no predicate,
    // and the query reads every tenant while each layer believes tenancy was
    // enforced. Contract validation refuses that shape, but this executor is
    // exported on its own and typed structurally, so it must refuse it too
    // rather than trusting the caller to have validated the contract.
    if (tenant !== undefined && rebuilt.tenantKey === undefined) {
      throw new PortableExecutionTenantError(
        `Dataset "${String(input.dataset.name)}" declares no tenant field, so a resolved tenant `
        + 'cannot be applied to it.',
      );
    }
    const context: ExecutionContext = tenant === undefined ? {} : { runtime: { tenant } };
    return { target, context };
  }

  function resolve(input: PortableSemanticExecutionInput) {
    const { target, context } = resolveTarget(input);
    return { target, query: semanticQuery(input.operation, input.budget.maxRows), context };
  }

  async function executeEventOperation(input: PortableEventExecutionInput): Promise<ProtocolSemanticInvocationResult> {
    const { target, context } = resolveTarget(input);
    const spec = eventOperationSpec(input.operation, target as never);
    // Trusted context, like a local client's `runtime.constraints`, so they
    // scope the scan without counting as caller filters.
    const constraints = eventConstraintFilters(input.constraints ?? []);
    const scoped: ExecutionContext = constraints.length === 0
      ? context
      : { ...context, runtime: { ...context.runtime, constraints } };
    const rows = await withDeadline(input.budget, input.signal, async signal => (
      prepareEventOperation(target as never, spec, {
        builderFactory: toQueryBuilderFactory(options.queryBuilder),
        ...(options.now === undefined ? {} : { now: options.now }),
        context: { ...scoped, abortSignal: signal },
      }).execute()
    ));
    return bounded(Object.freeze({
      kind: 'hypequery-semantic-invocation-result',
      version: 1,
      activationRevision: input.activationRevision,
      data: rows,
      meta: { rowCount: rows.length },
    }) as unknown as ProtocolSemanticInvocationResult, input.budget);
  }

  async function execute(input: PortableSemanticExecutionInput): Promise<ProtocolSemanticInvocationResult> {
    const { target, query, context } = resolve(input);

    const output = await withDeadline(input.budget, input.signal, async signal => (
      await client.execute(target as never, query as never, {
        abortSignal: signal,
        ...context,
      } as never)
    )) as { data?: readonly Record<string, unknown>[]; meta?: { pagination?: unknown } };

    const rows = output.data ?? [];
    const pagination = output.meta?.pagination as
      | { limit: number; offset: number; hasMore: boolean }
      | undefined;

    return bounded(Object.freeze({
      kind: 'hypequery-semantic-invocation-result',
      version: 1,
      activationRevision: input.activationRevision,
      data: rows,
      meta: {
        rowCount: rows.length,
        ...(pagination === undefined ? {} : { pagination }),
      },
    }) as unknown as ProtocolSemanticInvocationResult, input.budget);
  }

  return {
    compile(input) {
      const { target, query, context } = resolve(input);
      const compilation = client.compileDataset(target, query, context);
      const description = Object.freeze({
        ...compilation.describe(), activationRevision: input.activationRevision,
      });
      return Object.freeze({
        ...compilation,
        activationRevision: input.activationRevision,
        describe: () => description,
        toJSON: () => description,
      });
    },
    execute,
    executeEventOperation,
  };
}

/** Backwards-compatible executor adapter for the deployment data plane. */
export function createPortableSemanticExecutor(
  options: PortableSemanticExecutorOptions,
): (input: PortableSemanticExecutionInput) => Promise<ProtocolSemanticInvocationResult> {
  return createPortableSemanticRuntime(options).execute;
}
