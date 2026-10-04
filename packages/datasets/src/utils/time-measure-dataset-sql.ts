import { queryMeasureDefinitions } from './relationship-measures.js';
import { buildCompositeTimeMeasureSql } from './composite-time-measure-sql.js';
import { measureDependencyNames } from './measure-dependencies.js';
import type { AnyDatasetInstance, DatasetQuery } from '../types.js';
import type { DatasetQueryExecutionOptions } from '../dataset-query.js';
import { getBaseMeasure, getDerivedMeasure, isShiftMeasure, isWindowMeasure } from './dataset-measures.js';
import { selectedTimeMeasures } from './time-query-measures.js';
import { analyzeTimeMeasureAxis } from './time-measure-axis.js';
import { validateDatasetQueryInput } from './dataset-query-validation.js';
import { addTimeSql as add } from './time-arithmetic-sql.js';
import { shiftBucketCtes } from './shift-measure-sql.js';
import { buildTimeMeasureSourceSql } from './time-measure-source-sql.js';
import { buildTimeMeasureAxisSql } from './time-measure-axis-sql.js';
import { buildTimeMeasureValuesSql, windowMeasureRowsSql, windowScanStartSql } from './time-measure-values-sql.js';
import { buildTimeMeasureResultSql } from './time-measure-result-sql.js';

/** Plan source rows → output axis → window/shift values → final projection. */
export function buildTimeMeasureDatasetSql(
  ds: AnyDatasetInstance,
  query: DatasetQuery,
  options: DatasetQueryExecutionOptions,
): { sql: string; parameters: unknown[]; timeAxisSql: string } {
  const validation = validateDatasetQueryInput(ds, query, options.context);
  if (!validation.valid) throw new Error(`Invalid dataset query: ${validation.errors.join('; ')}`);
  const { axis } = analyzeTimeMeasureAxis(ds, query);
  if (!axis || !ds.timeKey) throw new Error('Window measures require a bounded time axis.');

  const dependencies = measureDependencyNames(queryMeasureDefinitions(ds, query.measures ?? []), query.measures ?? []);
  const composite = dependencies.some(name => {
    const definition = ds.measures[name];
    if (isShiftMeasure(definition)) return !getBaseMeasure(ds.measures, definition.measure);
    const derived = getDerivedMeasure(ds.measures, name);
    return derived && Object.values(derived.uses).some(input => getDerivedMeasure(ds.measures, input));
  });
  if (composite) return buildCompositeTimeMeasureSql(ds, query, options, axis);

  const timeMeasures = selectedTimeMeasures(ds, query);
  const windows = [...timeMeasures.values()].filter(isWindowMeasure);
  const shifts = [...timeMeasures.values()].filter(isShiftMeasure);
  const needed = new Set((query.measures ?? []).filter(name => !getDerivedMeasure(ds.measures, name)));
  for (const name of query.measures ?? []) {
    const derived = getDerivedMeasure(ds.measures, name);
    if (derived) Object.values(derived.uses).forEach(input => needed.add(input));
  }
  const baseNames = new Set([...needed].map(name => timeMeasures.get(name)?.measure ?? name));

  const source = buildTimeMeasureSourceSql(ds, query, baseNames, axis.filters, options);
  const timeAxis = buildTimeMeasureAxisSql(source, axis, shifts);
  const shiftedInputs = new Map<string, ReturnType<typeof shiftBucketCtes>>();
  [...needed].forEach((name, index) => {
    const measure = timeMeasures.get(name);
    if (isShiftMeasure(measure)) shiftedInputs.set(name, shiftBucketCtes(measure, axis, index));
  });

  // Scan only requested populations: intervening rows must not introduce dimensions.
  const end = add('_hq_last', 1, axis.grain);
  const populations: string[] = [];
  if ([...needed].some(name => name.includes('.') || getBaseMeasure(ds.measures, name))) {
    populations.push(`(_hq_time >= _hq_first AND _hq_time < ${end})`);
  }
  if (windows.length) {
    const starts = windows.filter(window => !window.cumulative)
      .map(window => windowScanStartSql(window, axis.grain));
    const lower = windows.some(window => window.cumulative)
      ? '' : ` AND _hq_time >= least(${starts.join(', ')})`;
    populations.push(`(_hq_time < ${end}${lower})`);
  }
  for (const shifted of shiftedInputs.values()) populations.push(`(_hq_time IN (${shifted.sourceTimesSql}))`);
  const scanCte = `_hq_scanned AS (SELECT * FROM _hq_source CROSS JOIN _hq_bounds WHERE ${populations.join(' OR ')})`;

  const inputs = [...needed].map(name => {
    const timeMeasure = timeMeasures.get(name);
    const window = isWindowMeasure(timeMeasure) ? timeMeasure : undefined;
    const base = source.bases.find(base => base.name === (timeMeasure?.measure ?? name));
    if (!base) throw new Error(`Missing base input for measure "${name}".`);
    if (isShiftMeasure(timeMeasure)) {
      const shifted = shiftedInputs.get(name)!;
      return { name, base, rowsSql: shifted.rowsSql, restrictToAxis: false };
    }
    return { name, base, window, rowsSql: windowMeasureRowsSql(window, axis) };
  });
  const values = buildTimeMeasureValuesSql(source.dimensions, inputs, axis);
  const sql = buildTimeMeasureResultSql(
    ds, query, options, source.dimensions,
    [...source.ctes, ...timeAxis.ctes, ...[...shiftedInputs.values()].flatMap(input => input.ctes), scanCte, ...values],
    `${timeAxis.guard} + ${timeAxis.rangeGuard} + ${timeAxis.postSeriesGuard}`,
  );
  return { sql, parameters: source.parameters, timeAxisSql: timeAxis.timeAxisSql };
}
