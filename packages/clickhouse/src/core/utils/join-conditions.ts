import type { ConditionValueNode, ExprNode, JoinConditionInput, ValueNode } from '../../types/index.js';

function wrapConditionValue(operator: JoinConditionInput['operator'], value: unknown): ConditionValueNode {
  if (operator === 'inSubquery' || operator === 'globalInSubquery' || operator === 'inTable' || operator === 'globalInTable') {
    return String(value);
  }
  if (operator === 'between') {
    const range = value as unknown[];
    return [
      { kind: 'value', value: range[0] },
      { kind: 'value', value: range[1] },
    ];
  }
  if (operator === 'inTuple' || operator === 'globalInTuple') {
    return (value as unknown[][]).map(tuple =>
      tuple.map(tupleValue => ({ kind: 'value' as const, value: tupleValue }))
    );
  }
  if (operator === 'in' || operator === 'notIn' || operator === 'globalIn' || operator === 'globalNotIn') {
    return (value as unknown[]).map(item => ({ kind: 'value' as const, value: item }));
  }
  return { kind: 'value', value } satisfies ValueNode;
}

export function buildOnExpression(conditions: JoinConditionInput | JoinConditionInput[]): ExprNode {
  const conditionList = Array.isArray(conditions) ? conditions : [conditions];
  const expressions: ExprNode[] = conditionList.map(condition => ({
    kind: 'condition',
    column: condition.column,
    operator: condition.operator,
    value: wrapConditionValue(condition.operator, condition.value),
  }));
  return expressions.length === 1
    ? expressions[0]
    : { kind: 'logical', operator: 'AND', conditions: expressions };
}

