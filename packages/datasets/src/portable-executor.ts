/**
 * Portable native execution of a semantic invocation.
 *
 * Decision 0005 chose this over a supervised runtime binding: resolve the
 * dataset or metric from the validated active contract, rebuild its catalog
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
  ProtocolDatasetContract,
  ProtocolDatasetMetric,
  ProtocolSemanticInvocationResult,
  ProtocolSemanticQuery,
} from '@hypequery/protocol';
import { createDatasetClient } from './executor.js';
import {
  rehydrateProtocolDatasets,
  UnsupportedContractFeatureError,
  type RehydratedDataset,
} from './protocol-rehydrate.js';
import type { QueryBuilderFactoryInput } from './query-builder-protocol.js';
import type {
  MetricFilter,
  MetricOrderBy,
  SemanticTenantRuntime,
  TimeGrain,
} from './types.js';
import { rehydrateMeasureFilter } from './utils/protocol-rehydrate-filters.js';

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
  readonly deployment: { readonly datasets: readonly ProtocolDatasetContract[] };
  readonly dataset: ProtocolDatasetContract;
  readonly metric?: ProtocolDatasetMetric;
  readonly operation: ProtocolSemanticQuery;
  /** Resolved by the provider callback; never caller-supplied. */
  readonly tenant: unknown;
  readonly budget: PortableSemanticBudget;
  /** Identifies the immutable generation, and keys the rebuilt catalog. */
  readonly activationRevision: string;
  readonly signal?: AbortSignal;
}

/** Signalled when portable execution cannot faithfully serve a target. */
export class PortableExecutionUnsupportedError extends Error {
  readonly code = 'HQ_SEMANTIC_UNSUPPORTED_CAPABILITY';
  /** Claims the portable failure category, so a data plane need not guess. */
  readonly category = 'unsupported-capability';

  constructor(message: string, options: { cause?: unknown } = {}) {
    super(message, options);
    this.name = 'PortableExecutionUnsupportedError';
  }
}

export class PortableExecutionBudgetError extends Error {
  readonly code = 'HQ_SEMANTIC_BUDGET_EXCEEDED';
  readonly category = 'budget-exceeded';

  constructor(message: string) {
    super(message);
    this.name = 'PortableExecutionBudgetError';
  }
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
}

type Registry = Readonly<Record<string, RehydratedDataset>>;

function tenantRuntime(tenant: unknown): SemanticTenantRuntime | undefined {
  if (tenant === undefined || tenant === null) return undefined;
  if (typeof tenant === 'string') return tenant;
  if (Array.isArray(tenant)) return { in: tenant.map(String) };
  return tenant as SemanticTenantRuntime;
}

function operationFilters(operation: ProtocolSemanticQuery): MetricFilter[] {
  return (operation.filters ?? []).map((expression, index) => rehydrateMeasureFilter(
    expression,
    () => new PortableExecutionUnsupportedError(
      `Filter ${index} is not a field/operator/value comparison, so it cannot be planned.`,
    ),
  ));
}

function semanticQuery(operation: ProtocolSemanticQuery, maxRows: number): Record<string, unknown> {
  const filters = operationFilters(operation);
  const orderBy: MetricOrderBy[] = (operation.orderBy ?? []).map(entry => ({
    field: String(entry.field),
    direction: entry.direction,
  }));
  return {
    ...(operation.dimensions === undefined
      ? {}
      : { dimensions: operation.dimensions.map(String) }),
    ...(operation.kind === 'dataset' && operation.measures !== undefined
      ? { measures: operation.measures.map(String) }
      : {}),
    ...(filters.length > 0 ? { filters } : {}),
    ...(orderBy.length > 0 ? { orderBy } : {}),
    // An omitted limit becomes the budget, so a caller cannot ask for an
    // unbounded scan by leaving it out.
    limit: operation.limit ?? maxRows,
    ...(operation.offset === undefined ? {} : { offset: operation.offset }),
    ...(operation.by === undefined ? {} : { by: operation.by as TimeGrain }),
  };
}

/**
 * Bounds a result by row count and serialized size before it leaves the
 * deployment, so an oversized answer fails rather than being streamed on.
 */
function boundedRows(
  rows: readonly Record<string, unknown>[],
  budget: PortableSemanticBudget,
): readonly Record<string, unknown>[] {
  if (rows.length > budget.maxRows) {
    throw new PortableExecutionBudgetError(
      `The result has ${rows.length} rows; the effective limit is ${budget.maxRows}.`,
    );
  }
  if (budget.maxResponseBytes !== undefined) {
    const bytes = new TextEncoder().encode(JSON.stringify(rows)).byteLength;
    if (bytes > budget.maxResponseBytes) {
      throw new PortableExecutionBudgetError(
        `The result is ${bytes} bytes; the effective limit is ${budget.maxResponseBytes}.`,
      );
    }
  }
  return rows;
}

/**
 * Runs `execute` under the caller's signal and the budget's deadline.
 *
 * The deadline is enforced with its own controller chained to the caller's, so
 * a timeout aborts the underlying database request rather than only abandoning
 * the promise.
 */
async function withDeadline<T>(
  budget: PortableSemanticBudget,
  signal: AbortSignal | undefined,
  execute: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  const controller = new AbortController();
  const abort = () => controller.abort(signal?.reason);
  signal?.addEventListener('abort', abort, { once: true });
  const timer = budget.deadlineMs === undefined
    ? undefined
    : setTimeout(() => controller.abort(new Error('The semantic invocation deadline elapsed.')),
      budget.deadlineMs);
  try {
    if (signal?.aborted) abort();
    return await execute(controller.signal);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
    signal?.removeEventListener('abort', abort);
  }
}

/**
 * Build the executor the deployment data plane injects.
 *
 * Returns the portable result record; the data plane validates it before it
 * reaches a caller.
 */
export function createPortableSemanticExecutor(
  options: PortableSemanticExecutorOptions,
): (input: PortableSemanticExecutionInput) => Promise<ProtocolSemanticInvocationResult> {
  const client = createDatasetClient({ queryBuilder: options.queryBuilder });
  let memo: { revision: string; registry: Registry } | undefined;

  function registryFor(input: PortableSemanticExecutionInput): Registry {
    if (options.cacheRebuiltCatalogs !== false && memo?.revision === input.activationRevision) {
      return memo.registry;
    }
    let registry: Registry;
    try {
      // Skip rather than throw: a single derived metric anywhere in the
      // contract must not make every other dataset unexecutable. The requested
      // target is still refused below when it is one of the skipped ones.
      registry = rehydrateProtocolDatasets(input.deployment.datasets, {
        onUnsupportedMetric: 'skip',
      });
    } catch (error) {
      if (error instanceof UnsupportedContractFeatureError) {
        // Decision 0005: a surface portable execution cannot reproduce is
        // excluded from it, never approximated.
        throw new PortableExecutionUnsupportedError(error.message, { cause: error });
      }
      throw error;
    }
    memo = { revision: input.activationRevision, registry };
    return registry;
  }

  return async function execute(
    input: PortableSemanticExecutionInput,
  ): Promise<ProtocolSemanticInvocationResult> {
    if (input.metric?.kind === 'derived-metric') {
      throw new PortableExecutionUnsupportedError(
        `Metric "${String(input.metric.name)}" is derived, and deployment contract v1 does not `
        + 'carry the symbolic expression portable execution needs to plan it.',
      );
    }

    const registry = registryFor(input);
    const rebuilt = registry[String(input.dataset.name)];
    if (rebuilt === undefined) {
      throw new PortableExecutionUnsupportedError(
        `Dataset "${String(input.dataset.name)}" is not part of the activated contract.`,
      );
    }
    const target = input.metric === undefined
      ? rebuilt
      : rebuilt.metrics[String(input.metric.name)];
    if (target === undefined) {
      throw new PortableExecutionUnsupportedError(
        `Metric "${String(input.metric?.name)}" could not be rebuilt from the contract.`,
      );
    }

    const tenant = tenantRuntime(input.tenant);
    const query = semanticQuery(input.operation, input.budget.maxRows);

    const output = await withDeadline(input.budget, input.signal, async signal => (
      await client.execute(target as never, query as never, {
        abortSignal: signal,
        ...(tenant === undefined ? {} : { runtime: { tenant } }),
      } as never)
    )) as { data?: readonly Record<string, unknown>[]; meta?: { pagination?: unknown } };

    const rows = boundedRows(output.data ?? [], input.budget);
    const pagination = output.meta?.pagination as
      | { limit: number; offset: number; hasMore: boolean }
      | undefined;

    return Object.freeze({
      kind: 'hypequery-semantic-invocation-result',
      version: 1,
      activationRevision: input.activationRevision,
      data: rows,
      meta: {
        rowCount: rows.length,
        ...(pagination === undefined ? {} : { pagination }),
      },
    }) as unknown as ProtocolSemanticInvocationResult;
  };
}
