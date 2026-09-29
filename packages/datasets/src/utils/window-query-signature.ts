import { measureDependencyNames } from './measure-dependencies.js';
import type { AnyDatasetInstance, DatasetQuery } from '../types.js';
import { getBaseMeasure, getDerivedMeasure } from './dataset-measures.js';
import { selectedTimeMeasures } from './time-query-measures.js';
import { windowCatalogMetadata } from './window-catalog-metadata.js';
import { measureToAggregationSpec } from './dataset-normalization.js';

/** Preserve existing cache keys; add execution dependencies for windows and shifts. */
export function windowQuerySignature(ds: AnyDatasetInstance, query: DatasetQuery, includeOrdinary = false): Record<string, unknown> {
  const timeMeasures = selectedTimeMeasures(ds, query);
  const dependencies = measureDependencyNames(ds.measures, query.measures ?? []);
  const nestedFormula = dependencies.some(name => {
    const formula = getDerivedMeasure(ds.measures, name);
    return formula && Object.values(formula.uses).some(input => getDerivedMeasure(ds.measures, input));
  });
  if (!timeMeasures.size && !nestedFormula && !includeOrdinary) return {};
  return {
    windowTimeKey: ds.timeKey,
    windowTimeDimension: ds.timeKey ? ds.dimensions[ds.timeKey] : undefined,
    baseInputs: dependencies.flatMap(name => {
      const base = getBaseMeasure(ds.measures, name);
      return base ? [{ name, ...measureToAggregationSpec(name, base) }] : [];
    }),
    windows: [...timeMeasures].sort(([a], [b]) => a.localeCompare(b)).map(([name, definition]) => {
      const base = getBaseMeasure(ds.measures, definition.measure);
      return { name, ...windowCatalogMetadata(definition), base: base ? measureToAggregationSpec(definition.measure, base) : undefined };
    }),
    windowFormulas: dependencies.flatMap(name => {
      const derived = getDerivedMeasure(ds.measures, name);
      if (!derived) return [];
      const aliases = Object.fromEntries(Object.keys(derived.uses).map(alias => [alias, alias]));
      return [{ name, uses: derived.uses, expression: derived.formula(aliases).expression }];
    }),
  };
}
