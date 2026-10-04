import type { DatasetQuery } from './types.js';

/** Trusted compiler output. SQL may contain literals supplied by a custom builder. */
export interface DatasetCompiledStatement {
  readonly sql: string;
  readonly parameters: readonly unknown[];
}

/** Structural diagnostics: no SQL, physical columns, filter values or tenant IDs. */
export interface DatasetCompilationDescription {
  readonly kind: 'dataset-compilation';
  readonly version: 1;
  readonly dataset: string;
  readonly plan: 'aggregate' | 'derived' | 'time';
  readonly dimensions: readonly string[];
  readonly measures: readonly string[];
  readonly measureDependencies: readonly string[];
  readonly filters: readonly { readonly field: string; readonly operator: string }[];
  /** Post-aggregation conditions, without their values. */
  readonly having: readonly { readonly measure: string; readonly operator: string }[];
  readonly segments: readonly string[];
  readonly by?: string;
  readonly timezone?: string;
  readonly effectiveLimit?: number;
  /** Includes the extra row used to determine pagination.hasMore. */
  readonly executionLimit?: number;
  readonly offset: number;
  readonly parameterCount: number;
  readonly preflightStatementCount: number;
}

/**
 * Dataset-level envelope around the current query-builder output. This is not
 * an RFC 0010 CompiledQuery: native named parameter binding remains an adapter
 * responsibility. Use describe()/JSON serialization for structural diagnostics;
 * inspect SQL and parameters only in an authorized, trusted debugger.
 */
export interface DatasetCompilation extends DatasetCompiledStatement {
  /** Normalized query, including its effective result limit and default measures. */
  readonly query: Readonly<DatasetQuery>;
  /** Statements executed before the result query, such as time-axis guards. */
  readonly preflightStatements: readonly DatasetCompiledStatement[];
  describe(): DatasetCompilationDescription;
  /** JSON serialization deliberately omits trusted SQL, parameters and values. */
  toJSON(): DatasetCompilationDescription;
}
