import type { FilterOperator } from '../../types/index.js';

export function validateTupleFilterValue(
  operator: FilterOperator,
  value: unknown,
  expectedWidth: number
): void {
  if (operator !== 'inTuple' && operator !== 'globalInTuple') {
    return;
  }

  if (!Array.isArray(value)) {
    throw new Error(`Expected an array of tuples for ${operator} operator, but got ${typeof value}`);
  }

  value.forEach((tuple: unknown, index: number) => {
    if (!Array.isArray(tuple)) {
      throw new Error(`Expected tuple ${index + 1} for ${operator} operator to be an array`);
    }
    if (tuple.length !== expectedWidth) {
      throw new Error(
        `Expected tuple ${index + 1} for ${operator} operator to have ${expectedWidth} value${expectedWidth === 1 ? '' : 's'}, but got ${tuple.length}`
      );
    }
  });
}
