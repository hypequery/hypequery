import { PortableExecutionUnsupportedError, PortableExecutionTenantError } from './portable-execution-errors.js';
export { PortableExecutionUnsupportedError, PortableExecutionBudgetError, PortableExecutionTenantError } from './portable-execution-errors.js';
import { tenantRuntime, semanticQuery } from './utils/portable-semantic-query.js';
import { bounded } from './utils/portable-result-budget.js';
import { withDeadline } from './utils/portable-execution-deadline.js';

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
    if (input.metric?.kind === 'derived-metric' && input.metric.derivation === undefined) {
      // A derived metric is executable once the contract carries the formula in
      // the shape it was authored in. One written before that field existed
      // still states only what the metric means, not the aliases its SQL is
      // written in terms of, so it stays excluded rather than approximated.
      throw new PortableExecutionUnsupportedError(
        `Metric "${String(input.metric.name)}" is derived, and this deployment contract does not `
        + 'carry the authored formula portable execution needs to plan it.',
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
    const query = semanticQuery(input.operation, input.budget.maxRows);

    const output = await withDeadline(input.budget, input.signal, async signal => (
      await client.execute(target as never, query as never, {
        abortSignal: signal,
        ...(tenant === undefined ? {} : { runtime: { tenant } }),
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
  };
}
