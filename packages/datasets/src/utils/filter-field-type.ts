import type { AnyDatasetInstance, FieldType } from '../types.js';
import { isQualifiedField, resolveQualifiedField } from './relationship-fields.js';

/**
 * The semantic field type behind a filter: a filter alias, a dimension name, or
 * a relationship-qualified target dimension. Undefined when the field does not
 * resolve to a declared dimension.
 */
export function resolveFilterFieldType(ds: AnyDatasetInstance, filterField: string): FieldType | undefined {
  if (isQualifiedField(filterField)) {
    return resolveQualifiedField(ds, filterField)?.resolved?.targetDimension.fieldType;
  }
  const resolvedField = ds.filters[filterField]?.field ?? filterField;
  return ds.dimensions[resolvedField]?.fieldType;
}
