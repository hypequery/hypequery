/**
 * Selection-only dimension rewrites for RFC 0026 `other`.
 *
 * `other` regroups one dimension as itself or a remainder label. Only the
 * grouped output reads the rewritten expression: filters, segments, measure
 * filters and measures over the same column keep reading source values,
 * because they resolve the dimension through `resolveDimensionExpression`.
 *
 * The rewrite travels on the dataset view under a symbol key, which object
 * spread copies, so views derived from it (a time-key rebase) keep it.
 */

import type { AnyDatasetInstance } from '../types.js';

const SELECTION_OVERRIDES = Symbol('hypequery.datasets.selectionOverrides');

type SelectionRewrite = (expression: string) => string;
type WithOverrides = { readonly [SELECTION_OVERRIDES]?: Readonly<Record<string, SelectionRewrite>> };

/** A view of `ds` whose `dimension`, when selected, reads `rewrite(expression)`. */
export function withDimensionSelectionRewrite<TDataset extends AnyDatasetInstance>(
  ds: TDataset,
  dimension: string,
  rewrite: SelectionRewrite,
): TDataset {
  const current = (ds as WithOverrides)[SELECTION_OVERRIDES] ?? {};
  return { ...ds, [SELECTION_OVERRIDES]: Object.freeze({ ...current, [dimension]: rewrite }) };
}

/** The expression a selected (grouped) dimension reads, given its source expression. */
export function rewriteSelectedDimension(ds: AnyDatasetInstance, dimension: string, expression: string): string {
  const rewrite = (ds as WithOverrides)[SELECTION_OVERRIDES]?.[dimension];
  return rewrite === undefined ? expression : rewrite(expression);
}
