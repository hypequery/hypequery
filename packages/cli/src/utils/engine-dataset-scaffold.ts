import type { ProtocolAggregateStateFunction } from '@hypequery/protocol';
import type { EngineMetadata } from './clickhouse-engine-metadata.js';

/** Engines whose rows hold partial aggregates rather than one event each. */
const PRE_AGGREGATED_FAMILIES = new Set(['AggregatingMergeTree', 'SummingMergeTree']);

export function isPreAggregatedFamily(family: string | undefined): boolean {
  return family !== undefined && PRE_AGGREGATED_FAMILIES.has(family);
}

export interface RowResolutionScaffold {
  /** Dataset config lines, indented for the generated `dataset(...)` call. */
  readonly lines: readonly string[];
  /** Bookkeeping columns of the engine: never summed or averaged. */
  readonly engineColumns: readonly string[];
}

/**
 * The `rowResolution` a dataset over this engine needs, so un-merged row
 * versions and cancelled rows are not counted. Undefined for engines whose
 * rows are already final.
 */
export function rowResolutionScaffold(engine: EngineMetadata | undefined): RowResolutionScaffold | undefined {
  if (!engine) return undefined;
  const engineColumns = [engine.versionColumn, engine.deletedColumn, engine.signColumn]
    .filter((column): column is string => column !== undefined);

  switch (engine.family) {
    case 'ReplacingMergeTree':
      return {
        lines: [
          '  // ReplacingMergeTree keeps old row versions until a background merge, so read',
          '  // with FINAL: otherwise every version counts.',
          engine.deletedColumn
            ? `  rowResolution: { kind: 'final', engine: 'replacing', deletedColumn: '${engine.deletedColumn}' },`
            : `  rowResolution: { kind: 'final', engine: 'replacing' },`,
        ],
        engineColumns,
      };
    case 'CollapsingMergeTree':
    case 'VersionedCollapsingMergeTree': {
      const kind = engine.family === 'CollapsingMergeTree' ? 'collapsing' : 'versioned-collapsing';
      // Without the sign column FINAL alone would still count cancelling rows.
      if (!engine.signColumn) return undefined;
      return {
        lines: [
          `  // ${engine.family} keeps cancelled rows until a background merge, so read`,
          `  // with FINAL and keep only ${engine.signColumn} = 1 rows.`,
          `  rowResolution: { kind: 'final', engine: '${kind}', signColumn: '${engine.signColumn}' },`,
        ],
        engineColumns,
      };
    }
    default:
      return undefined;
  }
}

const MERGE_MEASURE_PREFIX: Partial<Record<ProtocolAggregateStateFunction, { name: string; label: string }>> = {
  count: { name: 'total', label: 'Total' },
  sum: { name: 'total', label: 'Total' },
  avg: { name: 'avg', label: 'Average' },
  min: { name: 'min', label: 'Min' },
  max: { name: 'max', label: 'Max' },
  uniq: { name: 'unique', label: 'Unique' },
  uniqExact: { name: 'unique', label: 'Unique' },
  uniqCombined: { name: 'unique', label: 'Unique' },
  uniqCombined64: { name: 'unique', label: 'Unique' },
  uniqHLL12: { name: 'unique', label: 'Unique' },
  uniqTheta: { name: 'unique', label: 'Unique' },
  groupBitmap: { name: 'unique', label: 'Unique' },
};

/** Measure name and label prefix for a merge measure over `stateFunction` states. */
export function mergeMeasurePrefix(stateFunction: ProtocolAggregateStateFunction): { name: string; label: string } {
  return MERGE_MEASURE_PREFIX[stateFunction] ?? { name: stateFunction, label: stateFunction };
}
