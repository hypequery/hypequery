import type { AnyDatasetInstance, DatasetQuery } from '../types.js';
import { getBaseMeasure, getDerivedMeasure } from './dataset-measures.js';
import { selectedTimeMeasures } from './time-query-measures.js';
import { windowCatalogMetadata } from './window-catalog-metadata.js';
import { measureToAggregationSpec } from './dataset-normalization.js';

/** Preserve existing cache keys; add execution dependencies for windows and shifts. */
export function windowQuerySignature(ds: AnyDatasetInstance, query: DatasetQuery): Record<string, unknown> {
  const timeMeasures = selectedTimeMeasures(ds, query);
  if (!timeMeasures.size) return {};
  return {
    windowTimeKey: ds.timeKey,
    windowTimeDimension: ds.timeKey ? ds.dimensions[ds.timeKey] : undefined,
    windows: [...timeMeasures].sort(([a], [b]) => a.localeCompare(b)).map(([name, definition]) => {
      const base = getBaseMeasure(ds.measures, definition.measure);
      return { name, ...windowCatalogMetadata(definition), base: base ? measureToAggregationSpec(definition.measure, base) : undefined };
    }),
    windowFormulas: (query.measures ?? []).flatMap(name => {
      const derived = getDerivedMeasure(ds.measures, name);
      if (!derived) return [];
      const aliases = Object.fromEntries(Object.keys(derived.uses).map(alias => [alias, alias]));
      return [{ name, uses: derived.uses, expression: derived.formula(aliases).expression }];
    }),
  };
}
