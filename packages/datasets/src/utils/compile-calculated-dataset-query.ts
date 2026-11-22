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
import { selectedTimeMeasures } from './time-query-measures.js';
import { renderStatement, type PlannedStatement } from './statement-parameters.js';
import { statementRunner } from './statement-runner.js';
import { validateDatasetQueryInput } from './dataset-query-validation.js';
import { datasetOnTimeKey, selectedTimeKeyError } from './dataset-time-keys.js';
import { buildCalculationStageSql } from './calculation-stage-sql.js';
import { planQueryCalculations, publicCalculationErrors, type QueryCalculationPlan } from './query-calculation-plan.js';
import type { PreparedDatasetQuery, DatasetQueryMode } from './compile-dataset-query.js';

/** Thrown when a calculation names a kind or field this executor cannot run yet. */
export class UnsupportedQueryCalculationError extends Error {
  constructor(readonly reasons: readonly string[]) {
    super(reasons.join('; '));
    this.name = 'UnsupportedQueryCalculationError';
  }
}

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
): { errors: string[]; unsupported: readonly string[]; plan?: QueryCalculationPlan } {
  // Plan on the selected time axis, as every inner planner will.
  const axis = selectedTimeKeyError(ds, query.timeKey) ? ds : datasetOnTimeKey(ds, query.timeKey);
  const result = planQueryCalculations(axis, query, context);
  if (result.plan === undefined) return { errors: [...result.errors], unsupported: result.unsupported };
  const { plan } = result;
  const validation = validateDatasetQueryInput(plan.dataset, {
    ...plan.inner,
    ...(query.limit === undefined ? {} : { limit: query.limit }),
    ...(query.offset === undefined ? {} : { offset: query.offset }),
  }, context);
  return {
    errors: publicCalculationErrors(validation.errors, plan.outputs),
    unsupported: [],
    plan,
  };
}

function planOrThrow(ds: AnyDatasetInstance, query: DatasetQuery, context?: ExecutionContext): QueryCalculationPlan {
  const { errors, unsupported, plan } = calculatedDatasetQueryErrors(ds, query, context);
  if (unsupported.length > 0) throw new UnsupportedQueryCalculationError(unsupported);
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
  const view = plan.dataset;
  const dialect = resolveDatasetSqlDialect(options.builderFactory);
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
  if (selectedTimeMeasures(view, plan.inner).size > 0) {
    innerPlan = 'time';
    const time = buildTimeMeasureDatasetSql(view, plan.inner, innerOptions);
    planned = time.statement;
    preflight = time.preflight;
  } else {
    innerPlan = 'derived';
    planned = buildDerivedDatasetSql(view, plan.inner, innerOptions, buildDatasetQueryBuilder);
  }
  const outer = buildCalculationStageSql(query, plan, planned, dialect, executionLimit);
  const statement = withFinalSafety(readsFinal, renderStatement(outer));
  const preflightStatements: DatasetCompiledStatement[] = preflight === undefined
    ? []
    : [withFinalSafety(readsFinal, renderStatement(preflight))];

  const description: DatasetCompilationDescription = Object.freeze({
    kind: 'dataset-compilation', version: 1, dataset: dataset.name, plan: innerPlan,
    dimensions: Object.freeze([...(query.dimensions ?? [])]),
    measures: Object.freeze([...plan.selectedMeasures]),
    measureDependencies: Object.freeze(measureDependencyNames(
      queryMeasureDefinitions(dataset, [...plan.selectedMeasures]), [...plan.selectedMeasures],
    )),
    filters: Object.freeze((query.filters ?? []).map(({ field, operator }) => Object.freeze({ field, operator }))),
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
