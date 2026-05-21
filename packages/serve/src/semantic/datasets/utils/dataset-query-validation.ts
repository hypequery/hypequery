import type {
  DatasetInstance,
  MetricFilter,
  TimeGrain,
  ValidationResult,
} from '@hypequery/datasets';
import { validateFilterValue } from '@hypequery/datasets';

export type DatasetQueryValidationInput = {
  dimensions?: string[];
  measures?: string[];
  filters?: Array<{ field: string }>;
  orderBy?: Array<{ field: string }>;
  by?: TimeGrain;
};

export function validateDatasetQuery(
  ds: DatasetInstance,
  query: DatasetQueryValidationInput,
): ValidationResult {
  const errors: string[] = [];
  const dimensionNames = Object.keys(ds.dimensions);
  const measureNames = Object.keys(ds.measures);
  const selectedDimensions = query.dimensions ?? [];
  const selectedMeasures = query.measures ?? measureNames;
  const filterNames = Object.keys(ds.filters);
  const orderableFields = new Set<string>([
    ...selectedDimensions,
    ...selectedMeasures,
    ...(query.by ? ['period'] : []),
  ]);

  if (selectedDimensions.length === 0 && selectedMeasures.length === 0) {
    errors.push(`Dataset "${ds.name}" query must select at least one dimension or measure.`);
  }

  if (query.dimensions) {
    const invalid = query.dimensions.filter(column => !dimensionNames.includes(column));
    if (invalid.length > 0) {
      errors.push(`Unknown dimensions: ${invalid.join(', ')}. Available: ${dimensionNames.join(', ')}`);
    }
  }

  if (query.measures) {
    const invalid = query.measures.filter(column => !measureNames.includes(column));
    if (invalid.length > 0) {
      errors.push(`Unknown measures: ${invalid.join(', ')}. Available: ${measureNames.join(', ')}`);
    }
  }

  if (query.filters) {
    const invalid = query.filters.filter(filter => !filterNames.includes(filter.field));
    if (invalid.length > 0) {
      errors.push(`Unknown filter fields: ${invalid.map(filter => filter.field).join(', ')}. Available: ${filterNames.join(', ')}`);
    }

    for (const filter of query.filters) {
      const typedFilter = filter as MetricFilter;
      const filterDefinition = ds.filters[filter.field];
      if (filterDefinition?.operators && !filterDefinition.operators.includes(typedFilter.operator)) {
        errors.push(
          `Filter "${filter.field}" does not allow operator "${typedFilter.operator}". Allowed: ${filterDefinition.operators.join(', ')}`,
        );
        continue;
      }

      const resolvedField = ds.filters[filter.field]?.field ?? filter.field;
      const fieldType = ds.dimensions[resolvedField]?.fieldType;
      if (!fieldType) {
        continue;
      }

      const filterError = validateFilterValue(typedFilter, fieldType);
      if (filterError) {
        errors.push(filterError);
      }
    }
  }

  if (query.orderBy) {
    const invalid = query.orderBy.filter(order => !orderableFields.has(order.field));
    if (invalid.length > 0) {
      errors.push(`Unknown orderBy fields: ${invalid.map(order => order.field).join(', ')}. Available: ${Array.from(orderableFields).join(', ')}`);
    }
  }

  if (query.by && !ds.timeKey) {
    errors.push(`Cannot use "by" grain — dataset "${ds.name}" has no timeKey.`);
  }

  if (ds.limits?.maxDimensions && query.dimensions && query.dimensions.length > ds.limits.maxDimensions) {
    errors.push(`Too many dimensions: ${query.dimensions.length} (max ${ds.limits.maxDimensions})`);
  }

  if (ds.limits?.maxMeasures && query.measures && query.measures.length > ds.limits.maxMeasures) {
    errors.push(`Too many measures: ${query.measures.length} (max ${ds.limits.maxMeasures})`);
  }

  if (ds.limits?.maxFilters && query.filters && query.filters.length > ds.limits.maxFilters) {
    errors.push(`Too many filters: ${query.filters.length} (max ${ds.limits.maxFilters})`);
  }

  return { valid: errors.length === 0, errors };
}
