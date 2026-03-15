/**
 * defineDatasets() — standalone factory for dataset browse endpoint blocks.
 *
 * Returns a sealed DatasetsBlock that can be plugged into defineServe/createAPI.
 * Decouples dataset endpoint definition from the global API config.
 * The queryBuilder is provided once on the ServeConfig and flows down automatically.
 *
 * @example
 * ```ts
 * import { defineDatasets } from '@hypequery/serve';
 *
 * const datasets = defineDatasets({
 *   orders,
 *   customers: { dataset: customers, cache: 60_000 },
 * });
 *
 * const api = defineServe({ datasets, queryBuilder: qb });
 * ```
 */

import type { AuthContext, AuthStrategy } from '../../types.js';
import type { DatasetInstance } from './types.js';

// ---------------------------------------------------------------------------
// Per-dataset entry types
// ---------------------------------------------------------------------------

/** Shorthand (just the instance) or expanded with per-dataset overrides. */
export type DatasetEntryInput<TAuth extends AuthContext = AuthContext> =
  | DatasetInstance<any>
  | {
      dataset: DatasetInstance<any>;
      auth?: AuthStrategy<TAuth> | null;
      cache?: number | null;
      requiredRoles?: string[];
      requiredScopes?: string[];
      maxLimit?: number;
    };

/** Map of dataset names to entries. */
export type DatasetsInput<TAuth extends AuthContext = AuthContext> =
  Record<string, DatasetEntryInput<TAuth>>;

// ---------------------------------------------------------------------------
// Block-level options
// ---------------------------------------------------------------------------

/** Defaults applied to all datasets in this block. */
export interface DefineDatasetsOptions<TAuth extends AuthContext = AuthContext> {
  /** Default cache TTL (ms) for all dataset endpoints in this block. */
  cache?: number | null;
  /** Default auth strategy for all dataset endpoints in this block. */
  auth?: AuthStrategy<TAuth> | null;
  /** Default max row limit for all dataset endpoints in this block. */
  maxLimit?: number;
}

// ---------------------------------------------------------------------------
// DatasetsBlock — the sealed output
// ---------------------------------------------------------------------------

/** Opaque block returned by defineDatasets(). Consumed by createAPI/defineServe. */
export interface DatasetsBlock<TAuth extends AuthContext = AuthContext> {
  readonly __type: 'datasets_block';
  readonly entries: Record<string, DatasetEntryInput<TAuth>>;
  readonly defaults?: DefineDatasetsOptions<TAuth>;
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function defineDatasets<TAuth extends AuthContext = AuthContext>(
  datasets: DatasetsInput<TAuth>,
  options?: DefineDatasetsOptions<TAuth>,
): DatasetsBlock<TAuth> {
  return {
    __type: 'datasets_block',
    entries: datasets,
    defaults: options,
  };
}
