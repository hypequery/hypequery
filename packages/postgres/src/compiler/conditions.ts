import type { ConditionNode, PlaceholderWriter } from '../types.js';

const COMPARISONS: Record<string, string> = {
  eq: '=', neq: '<>', gt: '>', gte: '>=', lt: '<', lte: '<=', like: 'LIKE',
};

/** Render one predicate, binding every value through `placeholder`. */
export function compileCondition(condition: ConditionNode, placeholder: PlaceholderWriter): string {
  const { column, operator, value } = condition;
  switch (operator) {
    case 'in':
    case 'notIn': {
      const values = toList(value, operator);
      // `IN ()` is a syntax error; an empty list matches nothing (or everything).
      if (values.length === 0) return operator === 'in' ? 'FALSE' : 'TRUE';
      return `${column} ${operator === 'in' ? 'IN' : 'NOT IN'} (${values.map(placeholder).join(', ')})`;
    }
    case 'between': {
      const values = toList(value, operator);
      if (values.length !== 2) throw new Error('A between filter needs exactly two values.');
      return `${column} BETWEEN ${placeholder(values[0])} AND ${placeholder(values[1])}`;
    }
    default: {
      const symbol = COMPARISONS[operator];
      if (!symbol) throw new Error(`Unsupported filter operator: ${String(operator)}`);
      return `${column} ${symbol} ${placeholder(value)}`;
    }
  }
}

function toList(value: unknown, operator: string): readonly unknown[] {
  if (!Array.isArray(value)) throw new Error(`The ${operator} operator needs an array value.`);
  return value;
}
