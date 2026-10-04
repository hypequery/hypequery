import { queryMeasureDefinitions } from './relationship-measures.js';
import type { AnyDatasetInstance, DatasetQuery } from '../types.js';
import type { DatasetQueryExecutionOptions } from '../dataset-query.js';
import type { TimeMeasureAxis } from './time-measure-axis.js';
import { quoteSQLIdentifier } from '../sql-utils.js';
import { isDerivedMeasure, isWindowMeasure } from './dataset-measures.js';
import { buildMeasureEvaluationGraph, evaluationFormula } from './measure-evaluation-graph.js';
import { buildTimeMeasureSourceSql } from './time-measure-source-sql.js';
import { buildTimeMeasureAxisSql } from './time-measure-axis-sql.js';
import { timeMeasureContextCtes, timeMeasureContextGuard } from './time-measure-context-sql.js';
import { timeMeasureLeafSql } from './time-measure-leaf-sql.js';
import { derivedProjection } from './derived-measure-sql.js';
import { buildTimeMeasureResultSql } from './time-measure-result-sql.js';

/** Aggregate each dependency in its evaluation context, then evaluate formulas. */
export function buildCompositeTimeMeasureSql(ds: AnyDatasetInstance, query: DatasetQuery, options: DatasetQueryExecutionOptions, axis: TimeMeasureAxis) {
  const graph = buildMeasureEvaluationGraph(queryMeasureDefinitions(ds, query.measures ?? []), query.measures ?? []);
  const leaves = graph.nodes.filter(node => !isDerivedMeasure(node.definition));
  const baseNames = new Set(leaves.map(node => isWindowMeasure(node.definition) ? node.definition.measure : node.name));
  const source = buildTimeMeasureSourceSql(ds, query, baseNames, axis.filters, options);
  const timeAxis = buildTimeMeasureAxisSql(source, axis);
  const contexts = timeMeasureContextCtes(graph.contexts, axis);
  const inputs = leaves.map(node => {
    const window = isWindowMeasure(node.definition) ? node.definition : undefined;
    const base = source.bases.find(base => base.name === (window?.measure ?? node.name))!;
    return { node, ...timeMeasureLeafSql(node.id, node.context, base, window, axis, source.dimensions) };
  });
  const keys = source.dimensions.map(dim => dim.alias);
  const combinations = keys.length ? ` CROSS JOIN (SELECT DISTINCT ${keys.join(', ')} FROM (${inputs.map(input => `SELECT ${keys.join(', ')} FROM ${input.population}`).join(' UNION ALL ')})) AS _hq_combinations` : '';
  const guardCtes = [...source.ctes, ...timeAxis.ctes, ...contexts, ...inputs.flatMap(input => input.ctes)];
  const ctes = [...guardCtes,
    `_hq_skeleton AS (SELECT * FROM _hq_series${combinations})`];
  let previous = '_hq_skeleton';
  for (const input of inputs) {
    const { node } = input;
    const output = `_hq_value${node.id}`;
    const next = `_hq_evaluated${node.id}`;
    const value = input.count ? `coalesce(m.${output}, 0)` : `m.${output}`;
    if (input.cumulative) {
      const partition = keys.length ? `tuple(${keys.map(key => `s.${key}`).join(', ')})` : 'tuple(0)';
      const lookup = `_hq_lookup${node.id}`;
      ctes.push(`${lookup} AS (SELECT s.*, c._hq_eval_end, ${partition} AS _hq_partition FROM ${previous} AS s INNER JOIN _hq_context${input.context} AS c ON s._hq_period = c._hq_period)`);
      ctes.push(`${next} AS (SELECT s.* EXCEPT (_hq_eval_end, _hq_partition), ${value} AS ${output} FROM ${lookup} AS s LEFT ASOF JOIN ${input.aggregate} AS m ON s._hq_partition = m._hq_partition AND s._hq_eval_end > m._hq_time)`);
    } else {
      const condition = ['s._hq_period = m._hq_period', ...keys.map(key => `isNotDistinctFrom(s.${key}, m.${key})`)];
      ctes.push(`${next} AS (SELECT s.*, ${value} AS ${output} FROM ${previous} AS s LEFT JOIN ${input.aggregate} AS m ON ${condition.join(' AND ')})`);
    }
    previous = next;
  }
  for (const node of graph.nodes.filter(node => isDerivedMeasure(node.definition))) {
    const next = `_hq_formula${node.id}`;
    ctes.push(`${next} AS (SELECT *, ${derivedProjection(`_hq_value${node.id}`, evaluationFormula(node))} FROM ${previous})`);
    previous = next;
  }
  const projections = ['v._hq_period AS period', ...source.dimensions.map(dim => `v.${dim.alias} AS ${quoteSQLIdentifier(dim.name)}`),
    ...Object.entries(graph.outputs).map(([name, id]) => `v._hq_value${id} AS ${quoteSQLIdentifier(name)}`)];
  ctes.push(`_hq_values AS (SELECT ${projections.join(', ')} FROM ${previous} AS v)`);
  const guard = [timeAxis.guard, timeAxis.rangeGuard, ...graph.contexts.map(context => timeMeasureContextGuard(context, axis)), ...inputs.map(input => input.guard)].join(' + ');
  return {
    sql: buildTimeMeasureResultSql(ds, query, options, source.dimensions, ctes, guard, true),
    parameters: source.parameters,
    timeAxisSql: `WITH ${guardCtes.join(',\n')} SELECT ${guard} AS _hq_validated FROM _hq_bounds`,
  };
}
