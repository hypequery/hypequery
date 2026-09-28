import type { AnyDatasetInstance, DatasetQuery } from '../types.js';
import type { DatasetQueryExecutionOptions } from '../dataset-query.js';
import { getDerivedMeasure } from './dataset-measures.js';
import { selectedWindowMeasures } from './window-query-measures.js';
import { analyzeWindowTimeAxis } from './window-time-axis.js';
import { validateDatasetQueryInput } from './dataset-query-validation.js';
import { addTimeSql } from './time-arithmetic-sql.js';
import { buildTimeMeasureSourceSql } from './time-measure-source-sql.js';
import { buildTimeMeasureAxisSql } from './time-measure-axis-sql.js';
import { buildTimeMeasureValuesSql, windowMeasureRowsSql, windowScanStartSql } from './time-measure-values-sql.js';
import { buildTimeMeasureResultSql } from './time-measure-result-sql.js';

/** Plan source rows → output axis → window values → final projection. */
export function buildWindowDatasetSql(
  ds: AnyDatasetInstance,
  query: DatasetQuery,
  options: DatasetQueryExecutionOptions,
): { sql: string; parameters: unknown[]; timeAxisSql: string } {
  const validation = validateDatasetQueryInput(ds, query, options.context);
  if (!validation.valid) throw new Error(`Invalid dataset query: ${validation.errors.join('; ')}`);
  const { axis } = analyzeWindowTimeAxis(ds, query);
  if (!axis || !ds.timeKey) throw new Error('Window measures require a bounded time axis.');

  const windows = selectedWindowMeasures(ds, query);
  const needed = new Set((query.measures ?? []).filter(name => !getDerivedMeasure(ds.measures, name)));
  for (const name of query.measures ?? []) {
    const derived = getDerivedMeasure(ds.measures, name);
    if (derived) Object.values(derived.uses).forEach(input => needed.add(input));
  }
  const baseNames = new Set([...needed].map(name => windows.get(name)?.measure ?? name));

  // Source predicates retain tenancy and non-time filters throughout lookback.
  const source = buildTimeMeasureSourceSql(ds, query, baseNames, axis.filters, options);
  const timeAxis = buildTimeMeasureAxisSql(source, axis);

  // Include current buckets for base measures, and all history for cumulative ones.
  const starts = [...windows.values()]
    .filter(window => !window.cumulative)
    .map(window => windowScanStartSql(window, axis.grain));
  starts.push('_hq_first');
  const lowerScan = [...windows.values()].some(window => window.cumulative)
    ? '' : ` AND _hq_time >= least(${starts.join(', ')})`;
  const scanCte = `_hq_scanned AS (SELECT * FROM _hq_source CROSS JOIN _hq_bounds WHERE _hq_time < ${addTimeSql('_hq_last', 1, axis.grain)}${lowerScan})`;

  const inputs = [...needed].map(name => {
    const window = windows.get(name);
    const base = source.bases.find(base => base.name === (window?.measure ?? name));
    if (!base) throw new Error(`Missing base input for measure "${name}".`);
    return { name, base, window, rowsSql: windowMeasureRowsSql(window, axis) };
  });
  const values = buildTimeMeasureValuesSql(source.dimensions, inputs, axis);
  const sql = buildTimeMeasureResultSql(
    ds, query, options, source.dimensions,
    [...source.ctes, ...timeAxis.ctes, scanCte, ...values],
    `${timeAxis.guard} + ${timeAxis.rangeGuard}`,
  );
  return { sql, parameters: source.parameters, timeAxisSql: timeAxis.timeAxisSql };
}
