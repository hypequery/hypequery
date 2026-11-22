/**
 * Compilation of a dataset query that carries RFC 0026 calculations.
 *
 * The query is planned against a view of the dataset that holds each
 * calculation as a measure; the inner statement comes from the same derived
 * or time-measure planner a model-level query would use, and the outer stage
 * names, filters, orders and pages its rows.
 */

import { queryReadsFinal, withFinalSafety } from './dataset-source.js';
import { buildRelationshipBuilderContext } from './relationship-builder-plan.js';
import { resolveDatasetSqlDialect } from './dataset-sql-dialect.js';
import type { DatasetCompilation, DatasetCompilationDescription, DatasetCompiledStatement } from '../dataset-compilation.js';
import type { DatasetQueryExecutionOptions } from '../dataset-query.js';
import { buildDatasetQueryBuilder } from './build-dataset-query-builder.js';
import type { AnyDatasetInstance, DatasetQuery, ExecutionContext } from '../types.js';
import { buildDerivedDatasetSql } from './dataset-derived-query.js';
import { measureDependencyNames } from './measure-dependencies.js';
import { queryMeasureDefinitions } from './relationship-measures.js';
import { overfetchLimit } from './pagination.js';
import { buildTimeMeasureDatasetSql } from './time-measure-dataset-sql.js';
import { usesTimeSeriesPlan } from './time-query-measures.js';
import { filterLeaves } from './filter-tree.js';
import { renderStatement, type PlannedStatement } from './statement-parameters.js';
import { statementRunner } from './statement-runner.js';
import { validateDatasetQueryInput } from './dataset-query-validation.js';
import { datasetOnTimeKey, selectedTimeKeyError } from './dataset-time-keys.js';
import { buildCalculationStageSql, withOtherTop } from './calculation-stage-sql.js';
import { planQueryCalculations, publicCalculationErrors, type QueryCalculationPlan } from './query-calculation-plan.js';
import { assertStageSupported, otherRankingSql, withOtherBucket } from './other-bucket-sql.js';
import type { PreparedDatasetQuery, DatasetQueryMode } from './compile-dataset-query.js';


/**
 * Every reason a calculated query cannot run, with the caller's names. The
 * inner query is validated with the outer limit and offset, so the
 * time-measure series bound sees the page the caller asked for and an invalid
 * page is refused before any SQL is built.
 */
export function calculatedDatasetQueryErrors(
  ds: AnyDatasetInstance,
  query: DatasetQuery,
  context?: ExecutionContext,
): { errors: string[]; plan?: QueryCalculationPlan } {
  // Plan on the selected time axis, as every inner planner will.
  const axis = selectedTimeKeyError(ds, query.timeKey) ? ds : datasetOnTimeKey(ds, query.timeKey);
  const result = planQueryCalculations(axis, query, context);
  if (result.plan === undefined) return { errors: [...result.errors] };
  const { plan } = result;
  const validation = validateDatasetQueryInput(plan.dataset, {
    ...plan.inner,
    ...(query.limit === undefined ? {} : { limit: query.limit }),
    ...(query.offset === undefined ? {} : { offset: query.offset }),
  }, context);
  return {
    errors: publicCalculationErrors(validation.errors, plan.outputs),
    plan,
  };
}

function planOrThrow(ds: AnyDatasetInstance, query: DatasetQuery, context?: ExecutionContext): QueryCalculationPlan {
  const { errors, plan } = calculatedDatasetQueryErrors(ds, query, context);
  if (errors.length > 0 || plan === undefined) throw new Error(`Invalid dataset query: ${errors.join('; ')}`);
  return plan;
}

export function prepareCalculatedDatasetQuery(
  dataset: AnyDatasetInstance,
  query: DatasetQuery,
  options: DatasetQueryExecutionOptions,
  mode: DatasetQueryMode,
): PreparedDatasetQuery {
  const plan = planOrThrow(dataset, query, options.context);
  const dialect = resolveDatasetSqlDialect(options.builderFactory);
  assertStageSupported(plan, dialect);
  const view = plan.other === undefined ? plan.dataset : withOtherBucket(plan.dataset, plan.other, dialect);
  const executionLimit = mode === 'execution' ? overfetchLimit(query.limit) : query.limit;
  // The inner statement is unpaged (the outer stage pages it), but the time
  // planner keeps the caller's limit as its exact series budget.
  const innerOptions: DatasetQueryExecutionOptions = {
    ...options, executionLimit: undefined, seriesLimit: query.limit,
  };
  const readsFinal = queryReadsFinal(
    view, buildRelationshipBuilderContext(view, plan.inner, options.context, dialect),
  );

  let planned: PlannedStatement;
  let preflight: PlannedStatement | undefined;
  let innerPlan: DatasetCompilationDescription['plan'];
  // A time measure or a filled series (RFC 0029) runs on the time-series planner.
  if (usesTimeSeriesPlan(view, plan.inner)) {
    innerPlan = 'time';
    const time = buildTimeMeasureDatasetSql(view, plan.inner, innerOptions);
    planned = time.statement;
    preflight = time.preflight;
  } else {
    innerPlan = 'derived';
    planned = buildDerivedDatasetSql(view, plan.inner, innerOptions, buildDatasetQueryBuilder);
  }
  // Each statement the stage embeds is planned and rendered on its own, with
  // the same tenancy, filters and segments as the inner one.
  const denominators = new Map(plan.shares.flatMap(share => (share.denominator === undefined ? [] : [[
    share.internal,
    renderStatement(buildDerivedDatasetSql(view, share.denominator, innerOptions, buildDatasetQueryBuilder)),
  ] as const])));
  const otherTop = plan.other === undefined
    ? undefined
    : renderStatement(otherRankingSql(plan.dataset, plan.other, innerOptions, dialect));
  const outer = buildCalculationStageSql(query, plan, planned, dialect, executionLimit, {
    denominators, ...(otherTop === undefined ? {} : { otherTop }),
  });
  const statement = withFinalSafety(readsFinal, renderStatement(outer));
  const preflightStatements: DatasetCompiledStatement[] = preflight === undefined
    ? []
    : [withFinalSafety(readsFinal, renderStatement(withOtherTop(preflight, otherTop, dialect)))];

  const description: DatasetCompilationDescription = Object.freeze({
    kind: 'dataset-compilation', version: 1, dataset: dataset.name, plan: innerPlan,
    dimensions: Object.freeze([...(query.dimensions ?? [])]),
    measures: Object.freeze([...plan.selectedMeasures]),
    measureDependencies: Object.freeze(measureDependencyNames(
      queryMeasureDefinitions(dataset, [...plan.selectedMeasures]), [...plan.selectedMeasures],
    )),
    filters: Object.freeze(filterLeaves(query.filters).map(({ field, operator }) => Object.freeze({ field, operator }))),
    having: Object.freeze((query.having ?? []).map(({ measure, operator }) => Object.freeze({ measure, operator }))),
    segments: Object.freeze([...(query.segments ?? [])]),
    by: query.by, timeKey: query.timeKey, timezone: query.timezone,
    effectiveLimit: query.limit, executionLimit, offset: query.offset ?? 0,
    parameterCount: statement.parameters.length,
    preflightStatementCount: preflightStatements.length,
    calculations: Object.freeze(plan.outputs.map(output => output.name)),
  });
  const compilation: DatasetCompilation = Object.freeze({
    sql: statement.sql,
    parameters: Object.freeze(structuredClone(statement.parameters)),
    query: Object.freeze(structuredClone({ ...query, measures: [...plan.selectedMeasures] })),
    preflightStatements: Object.freeze(preflightStatements.map(entry => Object.freeze({
      sql: entry.sql, parameters: Object.freeze(structuredClone(entry.parameters)),
    }))),
    describe: () => description,
    toJSON: () => description,
  });
  const runner = statementRunner(options.builderFactory, { kind: 'raw', statement }, {
    abortSignal: options.context?.abortSignal,
    preflight: preflightStatements,
  });
  return { compilation, ...runner };
}
