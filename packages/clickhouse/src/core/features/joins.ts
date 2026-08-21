import type { BuilderState, SchemaDefinition } from '../types/builder-state.js';
import { QueryBuilder } from '../query-builder.js';
import {
  JoinType,
  type ConditionValueNode,
  type ExprNode,
  type JoinConditionInput,
  type SelectQueryNode,
  type ValueNode,
} from '../../types/index.js';

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

function buildOnExpression(conditions: JoinConditionInput | JoinConditionInput[]): ExprNode {
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

export class JoinFeature<
  Schema extends SchemaDefinition<Schema>,
  State extends BuilderState<Schema, string, any, keyof Schema, Partial<Record<string, keyof Schema>>, any, any>
> {
  constructor(private builder: QueryBuilder<Schema, State>) { }

  addJoin<TableName extends keyof Schema>(
    type: JoinType,
    table: TableName,
    leftColumn: string,
    rightColumn: `${TableName & string}.${keyof Schema[TableName] & string}`,
    alias?: string,
    leftSource?: string,
    on?: JoinConditionInput | JoinConditionInput[],
  ): SelectQueryNode<State['output'], Schema> {
    const query = this.builder.getQueryNode();
    const renderedRightColumn = alias
      ? rightColumn.replace(`${String(table)}.`, `${alias}.`) as typeof rightColumn
      : rightColumn;
    const newConfig = {
      ...query,
      joins: [
        ...(query.joins || []),
        {
          kind: 'join' as const,
          type,
          table: String(table),
          leftColumn: String(leftColumn),
          leftSource,
          rightColumn: renderedRightColumn,
          alias,
          on: on ? buildOnExpression(on) : undefined,
        }
      ]
    };
    return newConfig;
  }
}
