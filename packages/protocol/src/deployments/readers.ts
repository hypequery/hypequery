/**
 * Version-neutral readers for contract datasets (RFC 0030).
 *
 * Each takes a dataset of any deployment contract version a consumer accepts,
 * so a consumer never branches on `version` or probes for a field name. When
 * a new contract version renames, moves or adds a field, its reader ships in
 * the same release.
 */

import type { ProtocolIdentifier, ProtocolQualifiedIdentifier } from '../identifiers/index.js';
import type { ProtocolQueryTimeGrain } from '../expressions/index.js';
import type {
  ProtocolDatasetContract,
  ProtocolDatasetFilter,
  ProtocolDatasetSegment,
  ProtocolDeploymentDatasetAnyVersion,
} from './types.js';

/** A contract dataset of any version, or an RFC 0006 dataset contract. */
export type ProtocolAnyVersionDataset = ProtocolDeploymentDatasetAnyVersion | ProtocolDatasetContract;

const EMPTY: readonly never[] = Object.freeze([]);

/** Every grain a query may bucket by, coarsest last. */
const QUERY_GRAINS: readonly ProtocolQueryTimeGrain[] = Object.freeze([
  'minute', 'hour', 'day', 'week', 'month', 'quarter', 'year',
]);

/** Contract 3 calls the allow-list `allowedFilters`; contract 2 calls it `filters`. */
function isAllowedFiltersDataset(dataset: object): dataset is { readonly allowedFilters: readonly ProtocolDatasetFilter[] } {
  return 'allowedFilters' in dataset && (dataset as { allowedFilters?: unknown }).allowedFilters !== undefined;
}

/**
 * The dataset's filter allow-list: `filters` in contract 2 and in RFC 0006
 * dataset contracts, `allowedFilters` in contract 3 (RFC 0015).
 */
export function datasetAllowedFilters(dataset: ProtocolAnyVersionDataset): readonly ProtocolDatasetFilter[] {
  if (isAllowedFiltersDataset(dataset)) return dataset.allowedFilters;
  return (dataset as { readonly filters?: readonly ProtocolDatasetFilter[] }).filters ?? EMPTY;
}

/**
 * A copy of `dataset` whose allow-list is `filters`, stored under the field
 * name the dataset's own contract version uses.
 */
export function withDatasetAllowedFilters<TDataset extends ProtocolAnyVersionDataset>(
  dataset: TDataset,
  filters: readonly ProtocolDatasetFilter[],
): TDataset {
  return (isAllowedFiltersDataset(dataset)
    ? { ...dataset, allowedFilters: filters }
    : { ...dataset, filters }) as TDataset;
}

/** The dataset's named segments; contract 2 cannot declare any. */
export function datasetSegments(dataset: ProtocolAnyVersionDataset): readonly ProtocolDatasetSegment[] {
  return (dataset as { readonly segments?: readonly ProtocolDatasetSegment[] }).segments ?? EMPTY;
}

/**
 * The time axes a query may select with `timeKey` (RFC 0029): the default
 * `timeField` first, then contract 3 `alternateTimeFields` in authored order.
 * Empty when the dataset has no time field.
 */
export function datasetTimeAxes(
  dataset: ProtocolAnyVersionDataset,
): readonly (ProtocolQualifiedIdentifier | ProtocolIdentifier)[] {
  if (dataset.timeField === undefined) return EMPTY;
  const alternates = (dataset as { readonly alternateTimeFields?: readonly ProtocolIdentifier[] }).alternateTimeFields ?? [];
  return Object.freeze([dataset.timeField, ...alternates]);
}

/**
 * The grains a query may bucket the dataset `by`: every grain from `minute`
 * to `year` when it has a time field, none otherwise. The contract version
 * does not narrow this (RFC 0030); `minute` and `hour` need semantic
 * invocation 2, which `semanticInvocationVersion` selects.
 */
export function datasetGrains(dataset: ProtocolAnyVersionDataset): readonly ProtocolQueryTimeGrain[] {
  return dataset.timeField === undefined ? EMPTY : QUERY_GRAINS;
}
