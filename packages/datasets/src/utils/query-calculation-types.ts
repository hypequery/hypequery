/**
 * Query-scoped calculations (RFC 0026) as the dataset client accepts them.
 *
 * The shapes mirror the portable query envelope, except that a `filter`
 * calculation's `where` uses the client's `{ field, operator, value }`
 * filters, exactly as `DatasetQuery.filters` does.
 */

import type { MetricFilter, TimeGrain } from '../types.js';

export type QueryCalculationKind = 'filter' | 'shift' | 'window' | 'formula' | 'compare' | 'rank' | 'share';

export type QueryFormulaOperator =
  | 'add' | 'subtract' | 'multiply' | 'divide'
  | 'nullIfZero' | 'coalesce' | 'round' | 'floor' | 'ceil'
  | 'percentChange';

/** A formula operand: an input reference, a finite number, or a nested node. */
export type QueryFormulaArgument = string | number | QueryFormulaNode;

export interface QueryFormulaNode {
  readonly op: QueryFormulaOperator;
  readonly args: readonly QueryFormulaArgument[];
}

export interface QueryCalculationInterval {
  readonly amount: number;
  readonly unit: TimeGrain;
}

export type QueryWindowCalculation =
  | { readonly measure: string; readonly trailing: QueryCalculationInterval; readonly toDate?: never; readonly cumulative?: never }
  | { readonly measure: string; readonly toDate: Exclude<TimeGrain, 'minute'>; readonly trailing?: never; readonly cumulative?: never }
  | { readonly measure: string; readonly cumulative: true; readonly trailing?: never; readonly toDate?: never };

export type DatasetQueryCalculation =
  | { readonly name: string; readonly filter: { readonly measure: string; readonly where: readonly MetricFilter[] } }
  | { readonly name: string; readonly shift: { readonly measure: string } & QueryCalculationInterval }
  | { readonly name: string; readonly window: QueryWindowCalculation }
  | { readonly name: string; readonly formula: QueryFormulaNode }
  | {
      readonly name: string;
      readonly compare: { readonly to: 'previousPeriod' | 'previousYear'; readonly measures: readonly string[] };
    }
  | {
      readonly name: string;
      readonly rank: { readonly measure: string; readonly within?: readonly string[]; readonly direction?: 'asc' | 'desc' };
    }
  | { readonly name: string; readonly share: { readonly measure: string; readonly of?: readonly string[] } };

/** Keep the first `n` rows of each `by` group in `orderBy` order. */
export interface DatasetQueryLimitBy {
  readonly n: number;
  readonly by: readonly string[];
}

/** Group `dimension` as itself for its top `n` values of `measure`, else as `label`. */
export interface DatasetQueryOtherBucket {
  readonly dimension: string;
  readonly n: number;
  readonly measure: string;
  readonly label?: string;
}

/** One output column a calculation adds to a result. */
export interface DatasetCalculationColumn {
  readonly name: string;
  readonly kind: Exclude<QueryCalculationKind, 'compare'>;
  /** The calculation entry that produced the column. */
  readonly calculation: string;
  /** The input the column varies, for filter, shift, window, rank and share. */
  readonly measure?: string;
  readonly type: 'number' | 'integer';
  readonly format?: 'ratio';
}
