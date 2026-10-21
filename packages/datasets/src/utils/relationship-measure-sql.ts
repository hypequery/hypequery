import type { AnyDatasetInstance, AggregationSpec } from '../types.js';
import { resolveRelationshipMeasure } from './relationship-measures.js';
import type { RelationshipBuilderContext } from './relationship-builder-plan.js';
import { resolveDimensionExpression } from '../query-planner.js';
import { measureToAggregationSpec } from './dataset-normalization.js';
import { applyFilteredAggregationExpression } from './filtered-aggregation-sql.js';
import type { DatasetSqlDialectRules } from '../dataset-sql-dialect.js';

/**
 * The joined target as a projection whose marker is non-null only on a match.
 *
 * Without `join_use_nulls`, an unmatched LEFT JOIN row carries column defaults
 * such as `0` and `''`, which `min` or `countDistinct` would count and which
 * joined dimensions would expose as data. The marker is the one value that
 * tells a match from a default, and an explicit projection keeps it from
 * colliding with a target column. `names` are the related measures selected
 * from the target (possibly none); the projection always carries the join
 * keys, the tenant key and every column-backed dimension.
 */
export function relationshipJoinSource(target: AnyDatasetInstance, to: readonly string[], names: readonly string[], dialect: DatasetSqlDialectRules) {
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
  const source = dialect.quoteQualifiedName(target.source);
  // Sorted so the SQL is byte-identical however the target's dimensions are
  // ordered (authored vs. rehydrated catalogs declare them differently).
  const projection = [...columns].sort().map(quote);
  return { source: `(SELECT ${[...projection, `${dialect.toNullable('1')} AS ${quote(marker)}`].join(', ')} FROM ${source})`, marker };
}

export function relationshipMeasureExpressions(ds: AnyDatasetInstance, name: string, joinCtx: RelationshipBuilderContext, dialect: DatasetSqlDialectRules) {
  const resolved = resolveRelationshipMeasure(ds, name);
  const { relationshipName, target, definition } = resolved;
  const marker = joinCtx.joinByRelationship.get(relationshipName)?.matchMarker;
  if (!marker) throw new Error(`Missing match marker for relationship measure "${name}".`);
  const ownerContext = { ...joinCtx, baseSource: relationshipName };
  const spec: AggregationSpec = measureToAggregationSpec(name, definition);
  const matched = dialect.isNotNull(`${relationshipName}.${marker}`);
  const field = definition.field === '*' ? `${relationshipName}.${marker}` : resolveDimensionExpression(target, definition.field, ownerContext);
  const filtered = applyFilteredAggregationExpression(target, spec, field, ownerContext, dialect);
  return {
    definition,
    field: dialect.ifElse(matched, filtered, 'NULL'),
    arg: definition.argField ? dialect.ifElse(matched, resolveDimensionExpression(target, definition.argField, ownerContext), 'NULL') : undefined,
  };
}
