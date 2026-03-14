/**
 * Field helpers — lightweight type markers for dataset field definitions.
 *
 * @example
 * ```ts
 * import { field } from '@hypequery/serve';
 *
 * const Orders = dataset("orders", {
 *   source: "orders",
 *   fields: {
 *     id: field.string(),
 *     amount: field.number({ label: "Amount" }),
 *     createdAt: field.timestamp({ label: "Created At" }),
 *   },
 * });
 * ```
 */

import type { FieldDefinition, FieldOptions, FieldType } from './types.js';

function createFieldHelper<T extends FieldType>(fieldType: T) {
  return (opts?: FieldOptions): FieldDefinition<T> => ({
    __type: 'field_definition',
    fieldType,
    label: opts?.label,
    description: opts?.description,
  });
}

export const field = {
  string: createFieldHelper('string'),
  number: createFieldHelper('number'),
  boolean: createFieldHelper('boolean'),
  timestamp: createFieldHelper('timestamp'),
} as const;
