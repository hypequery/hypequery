import type { DatasetCompilation, DatasetCompilationDescription, DatasetCompiledStatement } from '../dataset-compilation.js';
import type { DatasetQueryExecutionOptions } from '../dataset-query.js';
import { buildDatasetQueryBuilder } from './build-dataset-query-builder.js';
import type { AnyDatasetInstance, DatasetQuery } from '../types.js';
import { baseMeasureNames } from './dataset-measures.js';
import { buildDerivedDatasetSql, hasSelectedDerivedMeasure } from './dataset-derived-query.js';
import { measureDependencyNames } from './measure-dependencies.js';
import { overfetchLimit } from './pagination.js';
import { resolveResultLimit } from './result-limits.js';
import { buildTimeMeasureDatasetSql } from './time-measure-dataset-sql.js';
import { selectedTimeMeasures } from './time-query-measures.js';

export interface PreparedDatasetQuery {
  readonly compilation: DatasetCompilation;
  execute(): Promise<Record<string, unknown>[]>;
}

/** The one dispatch point for dataset preview and query-builder execution. */
export function prepareDatasetQuery(
  dataset: AnyDatasetInstance,
  input: DatasetQuery,
  options: DatasetQueryExecutionOptions,
  mode: 'execution' | 'logical' = 'execution',
): PreparedDatasetQuery {
  const query: DatasetQuery = structuredClone({
    ...input,
    measures: input.measures ?? baseMeasureNames(dataset.measures),
    limit: mode === 'execution' ? resolveResultLimit(input.limit, dataset.limits).limit : input.limit,
  });
  const executionLimit = mode === 'execution' ? overfetchLimit(query.limit) : query.limit;
  const executionOptions = { ...options, executionLimit };
  const preflightStatements: DatasetCompiledStatement[] = [];
  let statement: { sql: string; parameters: unknown[] };
  let execute: PreparedDatasetQuery['execute'];
  let plan: DatasetCompilationDescription['plan'];
  const abortSignal = options.context?.abortSignal;

  if (selectedTimeMeasures(dataset, query).size) {
    plan = 'time';
    const compiled = buildTimeMeasureDatasetSql(dataset, query, executionOptions);
    statement = compiled;
    preflightStatements.push({ sql: compiled.timeAxisSql, parameters: compiled.parameters });
    execute = async () => {
      await options.builderFactory.rawQuery(compiled.timeAxisSql, compiled.parameters, { abortSignal });
      return options.builderFactory.rawQuery(compiled.sql, compiled.parameters, { abortSignal });
    };
  } else if (hasSelectedDerivedMeasure(dataset, query)) {
    plan = 'derived';
    statement = buildDerivedDatasetSql(dataset, query, executionOptions, buildDatasetQueryBuilder);
    execute = () => options.builderFactory.rawQuery(statement.sql, statement.parameters, { abortSignal });
  } else {
    plan = 'aggregate';
    const builder = buildDatasetQueryBuilder(dataset, query, executionOptions);
    statement = builder.toSQLWithParams();
    // Retain builder execution: custom builders may carry adapter settings.
    execute = () => builder.execute({ abortSignal });
  }

  const description: DatasetCompilationDescription = Object.freeze({
    kind: 'dataset-compilation', version: 1, dataset: dataset.name, plan,
    dimensions: Object.freeze([...(query.dimensions ?? [])]),
    measures: Object.freeze([...(query.measures ?? [])]),
    measureDependencies: Object.freeze(measureDependencyNames(dataset.measures, query.measures ?? [])),
    filters: Object.freeze((query.filters ?? []).map(({ field, operator }) => Object.freeze({ field, operator }))),
    segments: Object.freeze([...(query.segments ?? [])]),
    by: query.by, timezone: query.timezone,
    effectiveLimit: query.limit, executionLimit, offset: query.offset ?? 0,
    parameterCount: statement.parameters.length,
    preflightStatementCount: preflightStatements.length,
  });
  const compilation: DatasetCompilation = Object.freeze({
    sql: statement.sql,
    parameters: Object.freeze(structuredClone(statement.parameters)),
    query: Object.freeze(structuredClone(query)),
    preflightStatements: Object.freeze(preflightStatements.map(preflight => Object.freeze({
      sql: preflight.sql, parameters: Object.freeze(structuredClone(preflight.parameters)),
    }))),
    describe: () => description,
    toJSON: () => description,
  });
  return { compilation, execute };
}
