/**
 * Dimension helpers — lightweight semantic markers for dataset dimensions.
 *
 * @example
 * ```ts
 * import { dimension } from '@hypequery/serve';
 *
 * const Orders = dataset("orders", {
 *   source: "orders",
 *   dimensions: {
 *     id: dimension.string(),
 *     amount: dimension.number({ label: "Amount" }),
 *     createdAt: dimension.timestamp({ label: "Created At" }),
 *   },
 * });
 * ```
 */

import type { DimensionDefinition, DimensionOptions, FieldType } from './types.js';

function createFieldHelper<T extends FieldType>(fieldType: T) {
  return <TOptions extends DimensionOptions | undefined = undefined>(
    opts?: TOptions,
  ): DimensionDefinition<T> & (TOptions extends DimensionOptions ? TOptions : object) => ({
    __type: 'field_definition',
    fieldType,
    label: opts?.label,
    description: opts?.description,
    column: opts?.column,
    sql: opts?.sql,
    dependencies: opts?.dependencies,
    filterable: opts?.filterable,
    groupable: opts?.groupable,
  }) as DimensionDefinition<T> & (TOptions extends DimensionOptions ? TOptions : object);
}

export const dimension = {
  string: createFieldHelper('string'),
  number: createFieldHelper('number'),
  boolean: createFieldHelper('boolean'),
  timestamp: createFieldHelper('timestamp'),
} as const;
