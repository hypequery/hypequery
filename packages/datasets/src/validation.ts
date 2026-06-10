/**
 * Shared validation utilities for semantic layer queries.
 */

import type { FieldType, MetricFilter } from './types.js';

/**
 * Result of a validation operation.
 */
export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

/**
 * Throws a standard "Invalid <kind> query" error when validation failed.
 *
 * Centralizes the throw used by the executor and planners so the error
 * message stays consistent across query kinds.
 *
 * @param validation - The validation result to check.
 * @param queryKind - The query kind used in the message, e.g. 'metric' or 'dataset'.
 */
export function assertValid(validation: ValidationResult, queryKind: string): void {
  if (!validation.valid) {
    throw new Error(`Invalid ${queryKind} query: ${validation.errors.join('; ')}`);
  }
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
      return filter.value.every(value => matchesFieldType(fieldType, value))
        ? null
        : `"${filter.operator}" expects ${fieldType} values for field "${filter.field}".`;
    case 'between':
      if (!Array.isArray(filter.value) || filter.value.length !== 2) {
        return `"between" expects a two-item array for field "${filter.field}".`;
      }
      return filter.value.every(value => matchesFieldType(fieldType, value))
        ? null
        : `"between" expects ${fieldType} values for field "${filter.field}".`;
    default:
      return null;
  }
}
