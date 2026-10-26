import type { AnyDatasetInstance, DatasetQuery, MetricFilter } from '../types.js';
import { baseMeasureNames, isBaseMeasure } from './dataset-measures.js';
import { measureDependencies } from './measure-dependencies.js';
import { segmentFilters } from './segments.js';

function filterField(dataset: AnyDatasetInstance, filter: MetricFilter): string {
  return dataset.filters?.[filter.field]?.field ?? filter.field;
}

/**
 * Every field a query reads, as the planner will: requested names, the fields
 * named filters and segments stand for, and, for each selected measure (every
 * base measure when `measures` is omitted), its dependencies and the fields
 * its fixed filters read. A measure filter can name `<relationship>.<field>`,
 * so selecting a measure can join a relationship the request never names.
 */
export function queryFieldReferences(dataset: AnyDatasetInstance, query: DatasetQuery): string[] {
  const names: string[] = [
    ...(query.dimensions ?? []),
    ...(query.filters ?? []).map(filter => filterField(dataset, filter)),
    ...segmentFilters(dataset, query.segments).map(filter => filterField(dataset, filter)),
    ...(query.orderBy ?? []).map(order => order.field),
    ...(query.having ?? []).map(condition => condition.measure),
  ];
  const visited = new Set<string>();
  const visit = (name: string): void => {
    if (visited.has(name)) return;
    visited.add(name);
    names.push(name);
    if (!Object.hasOwn(dataset.measures, name)) return;
    const definition = dataset.measures[name];
    measureDependencies(definition).forEach(visit);
    if (isBaseMeasure(definition)) {
      names.push(...(definition.filters ?? []).map(filter => filterField(dataset, filter)));
    }
  };
  (query.measures ?? baseMeasureNames(dataset.measures)).forEach(visit);
  return names;
}
