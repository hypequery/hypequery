/**
 * Query-scoped calculations (RFC 0026): one-off variants of published
 * measures carried by an extension 2 dataset query and compiled by the same
 * planner as model-level measures.
 */

import type { ProtocolIdentifier } from '../identifiers/index.js';
import type { ProtocolExpression, ProtocolQueryTimeGrain } from './types.js';

/** Every calculation kind, in the order RFC 0026 lists them. */
export const PROTOCOL_CALCULATION_KINDS = Object.freeze([
  'filter', 'shift', 'window', 'formula', 'compare', 'rank', 'share',
] as const);

export type ProtocolCalculationKind = typeof PROTOCOL_CALCULATION_KINDS[number];

/** Operators a formula node may use. `percentChange(a, b)` is `(a - b) / NULLIF(b, 0)`. */
export type ProtocolFormulaOperator =
  | 'add' | 'subtract' | 'multiply' | 'divide'
  | 'nullIfZero' | 'coalesce' | 'round' | 'floor' | 'ceil'
  | 'percentChange';

/** A formula operand: an input reference, a finite number, or a nested node. */
export type ProtocolFormulaArgument = ProtocolIdentifier | number | ProtocolFormulaNode;

export interface ProtocolFormulaNode {
  readonly op: ProtocolFormulaOperator;
  readonly args: readonly ProtocolFormulaArgument[];
}

export interface ProtocolCalculationInterval {
  readonly amount: number;
  readonly unit: ProtocolQueryTimeGrain;
}

export interface ProtocolFilterCalculation {
  readonly measure: ProtocolIdentifier;
  /** AND-combined plain comparisons (reference op literal), as in `filters`. */
  readonly where: readonly ProtocolExpression[];
}

export interface ProtocolShiftCalculation extends ProtocolCalculationInterval {
  readonly measure: ProtocolIdentifier;
}

export type ProtocolWindowCalculation =
  | { readonly measure: ProtocolIdentifier; readonly trailing: ProtocolCalculationInterval }
  | { readonly measure: ProtocolIdentifier; readonly toDate: Exclude<ProtocolQueryTimeGrain, 'minute'> }
  | { readonly measure: ProtocolIdentifier; readonly cumulative: true };

export interface ProtocolCompareCalculation {
  readonly to: 'previousPeriod' | 'previousYear';
  readonly measures: readonly ProtocolIdentifier[];
}

export interface ProtocolRankCalculation {
  readonly measure: ProtocolIdentifier;
  /** Partition: selected dimensions, plus `period` when `by` is present. */
  readonly within?: readonly string[];
  /** Defaults to `desc`: rank 1 is the highest value. */
  readonly direction?: 'asc' | 'desc';
}

export interface ProtocolShareCalculation {
  readonly measure: ProtocolIdentifier;
  /** The grain the denominator keeps; absent or empty is the grand total. */
  readonly of?: readonly string[];
}

export type ProtocolQueryCalculation =
  | { readonly name: ProtocolIdentifier; readonly filter: ProtocolFilterCalculation }
  | { readonly name: ProtocolIdentifier; readonly shift: ProtocolShiftCalculation }
  | { readonly name: ProtocolIdentifier; readonly window: ProtocolWindowCalculation }
  | { readonly name: ProtocolIdentifier; readonly formula: ProtocolFormulaNode }
  | { readonly name: ProtocolIdentifier; readonly compare: ProtocolCompareCalculation }
  | { readonly name: ProtocolIdentifier; readonly rank: ProtocolRankCalculation }
  | { readonly name: ProtocolIdentifier; readonly share: ProtocolShareCalculation };

/** Keep the first `n` rows of each `by` group in `orderBy` order (`LIMIT n BY`). */
export interface ProtocolLimitBy {
  readonly n: number;
  readonly by: readonly string[];
}

/** Group `dimension` as itself for its top `n` values of `measure`, else as `label`. */
export interface ProtocolOtherBucket {
  readonly dimension: ProtocolIdentifier;
  readonly n: number;
  readonly measure: ProtocolIdentifier;
  /** Defaults to `"Other"`. */
  readonly label?: string;
}

/** One output column a calculation adds to a result (`meta.calculations`). */
export interface ProtocolCalculationColumn {
  readonly name: string;
  readonly kind: Exclude<ProtocolCalculationKind, 'compare'>;
  /** The calculation entry that produced the column. */
  readonly calculation: string;
  /** The input the column varies, for filter, shift, window, rank and share. */
  readonly measure?: string;
  readonly type: 'number' | 'integer';
  readonly format?: 'ratio';
}
