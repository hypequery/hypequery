/**
 * Shared validation utilities for semantic layer queries.
 */

import type { FieldType, MetricFilter } from './types.js';
import { parseTimestampInstant } from './utils/timestamp-instants.js';

/**
 * Result of a validation operation.
 */
export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

/**
 * Checks if a value matches the expected field type.
 *
 * @param fieldType - The expected field type
 * @param value - The value to check
 * @returns true if the value matches the field type
 */
export function matchesFieldType(fieldType: FieldType, value: unknown): boolean {
  switch (fieldType) {
    case 'string':
    case 'timestamp':
      return typeof value === 'string';
    case 'number':
      return typeof value === 'number' && Number.isFinite(value);
    case 'boolean':
      return typeof value === 'boolean';
    default:
      return false;
  }
}

/** True when a list holds both instants (`Z` or an offset) and offset-free timestamps. */
export function mixesInstantsAndLocalTimes(values: readonly unknown[]): boolean {
  const instants = values.map(value => parseTimestampInstant(value) !== undefined);
  return instants.some(Boolean) && !instants.every(Boolean);
}

/**
 * An `in` list is one predicate, so every member is read in the same zone:
 * an instant and a local time cannot share one without changing a meaning.
 */
export function mixedInstantListError(field: string): string {
  return `"in" cannot mix instants (with Z or an offset) and local timestamps for field "${field}"; use one form.`;
}

/**
 * Validates a filter value against the expected field type.
 *
 * @param filter - The filter to validate
 * @param fieldType - The expected field type
 * @returns null if valid, error message if invalid
 */
export function validateFilterValue(filter: MetricFilter, fieldType: FieldType): string | null {
  switch (filter.operator) {
    case 'eq':
    case 'neq':
      return matchesFieldType(fieldType, filter.value)
        ? null
        : `"${filter.operator}" expects a ${fieldType} value for field "${filter.field}".`;
    case 'gt':
    case 'gte':
    case 'lt':
    case 'lte':
      if (fieldType === 'boolean') {
        return `"${filter.operator}" is not supported for boolean field "${filter.field}".`;
      }
      return matchesFieldType(fieldType, filter.value)
        ? null
        : `"${filter.operator}" expects a ${fieldType} value for field "${filter.field}".`;
    case 'like':
      if (fieldType !== 'string' && fieldType !== 'timestamp') {
        return `"like" is only supported for string or timestamp field "${filter.field}".`;
      }
      return typeof filter.value === 'string'
        ? null
        : `"like" expects a string value for field "${filter.field}".`;
    case 'in':
    case 'notIn':
      if (!Array.isArray(filter.value) || filter.value.length === 0) {
        return `"${filter.operator}" expects a non-empty array for field "${filter.field}".`;
      }
      if (!filter.value.every(value => matchesFieldType(fieldType, value))) {
        return `"${filter.operator}" expects ${fieldType} values for field "${filter.field}".`;
      }
      return filter.operator === 'in' && fieldType === 'timestamp' && mixesInstantsAndLocalTimes(filter.value)
        ? mixedInstantListError(filter.field)
        : null;
    case 'between':
      if (!Array.isArray(filter.value) || filter.value.length !== 2) {
        return `"between" expects a two-item array for field "${filter.field}".`;
      }
      return filter.value.every(value => matchesFieldType(fieldType, value))
        ? null
        : `"between" expects ${fieldType} values for field "${filter.field}".`;
    default:
      return `Unsupported semantic filter operator "${String(filter.operator)}".`;
  }
}
