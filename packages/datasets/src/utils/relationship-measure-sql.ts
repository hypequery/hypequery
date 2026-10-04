import type { AnyDatasetInstance, AggregationSpec } from '../types.js';
import { resolveRelationshipMeasure } from './relationship-measures.js';
import type { RelationshipBuilderContext } from './relationship-builder-plan.js';
import { resolveDimensionExpression } from '../query-planner.js';
import { measureToAggregationSpec } from './dataset-normalization.js';
import { applyFilteredAggregationExpression } from './filtered-aggregation-sql.js';
import type { DatasetSqlDialect } from '../dataset-sql-dialect.js';

/** Explicit projection avoids marker collisions and makes absent targets detectable under join_use_nulls=0. */
export function relationshipMeasureSource(target: AnyDatasetInstance, to: readonly string[], names: readonly string[], dialect: DatasetSqlDialect) {
  const columns = new Set([...to, ...(target.tenantKey ? [target.tenantKey] : [])]);
  for (const [name, dimension] of Object.entries(target.dimensions)) if (!dimension.sql) columns.add(dimension.column ?? name);
  for (const name of names) {
    const measure = target.measures[name];
    if (measure.__type !== 'measure_definition') continue;
    for (const field of [measure.field, measure.argField, ...(measure.filters ?? []).map(filter => target.filters[filter.field]?.field ?? filter.field)]) {
      if (field && field !== '*') columns.add(target.dimensions[field]?.column ?? field);
    }
  }
  let marker = '_hq_match';
  while (columns.has(marker)) marker += '_';
  const quote = dialect.quoteIdentifier;
  const source = target.source.split('.').map(quote).join('.');
  const projection = [...columns].map(quote);
  return { source: `(SELECT ${[...projection, `toNullable(1) AS ${quote(marker)}`].join(', ')} FROM ${source})`, marker };
}

export function relationshipMeasureExpressions(ds: AnyDatasetInstance, name: string, joinCtx: RelationshipBuilderContext) {
  const resolved = resolveRelationshipMeasure(ds, name);
  const { relationshipName, target, definition } = resolved;
  const marker = joinCtx.joinByRelationship.get(relationshipName)?.matchMarker;
  if (!marker) throw new Error(`Missing match marker for relationship measure "${name}".`);
  const ownerContext = { ...joinCtx, baseSource: relationshipName };
  const spec: AggregationSpec = measureToAggregationSpec(name, definition);
  const matched = `isNotNull(${relationshipName}.${marker})`;
  const field = definition.field === '*' ? `${relationshipName}.${marker}` : resolveDimensionExpression(target, definition.field, ownerContext);
  const filtered = applyFilteredAggregationExpression(target, spec, field, ownerContext);
  return {
    definition,
    field: `if(${matched}, ${filtered}, NULL)`,
    arg: definition.argField ? `if(${matched}, ${resolveDimensionExpression(target, definition.argField, ownerContext)}, NULL)` : undefined,
  };
}
