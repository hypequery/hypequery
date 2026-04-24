import type { BuilderState, SchemaDefinition } from '../types/builder-state.js';
import { QueryBuilder } from '../query-builder.js';
import { FilterOperator, type ExprNode, type ValueNode } from '../../types/index.js';
import { PredicateExpression } from '../utils/predicate-builder.js';

function appendExpression(
  existing: ExprNode | undefined,
  next: ExprNode,
  conjunction: 'AND' | 'OR'
): ExprNode {
  if (!existing) {
    return next;
  }

  if (existing.kind === 'sequence') {
    return {
      ...existing,
      items: [...existing.items, { conjunction, expression: next }],
    };
  }

  return {
    kind: 'sequence',
    items: [
      { expression: existing },
      { conjunction, expression: next },
    ],
  };
}

export class FilteringFeature<
  Schema extends SchemaDefinition<Schema>,
  State extends BuilderState<Schema, string, any, keyof Schema, Partial<Record<string, keyof Schema>>>
> {
  constructor(private builder: QueryBuilder<Schema, State>) { }

  private wrapValue(operator: FilterOperator, value: any) {
    if (operator === 'inSubquery' || operator === 'globalInSubquery' || operator === 'inTable' || operator === 'globalInTable') {
      return value;
    }

    if (operator === 'between') {
      return [
        { kind: 'value' as const, value: value[0] },
        { kind: 'value' as const, value: value[1] },
      ] as [ValueNode, ValueNode];
    }

    if (operator === 'inTuple' || operator === 'globalInTuple') {
      return value.map((tuple: any[]) => tuple.map(tupleValue => ({ kind: 'value' as const, value: tupleValue })));
    }

    if (operator === 'in' || operator === 'notIn' || operator === 'globalIn' || operator === 'globalNotIn') {
      return value.map((item: any) => ({ kind: 'value' as const, value: item }));
    }

    return { kind: 'value' as const, value };
  }

  addCondition(
    clause: 'where' | 'prewhere',
    conjunction: 'AND' | 'OR',
    column: string | string[],
    operator: FilterOperator,
    value: any
  ) {
    const config = this.builder.getConfig();

    const columnString = Array.isArray(column)
      ? `(${column.map(String).join(', ')})`
      : String(column);

    if (operator === 'in' || operator === 'notIn' || operator === 'globalIn' || operator === 'globalNotIn') {
      if (!Array.isArray(value)) {
        throw new Error(`Expected an array for ${operator} operator, but got ${typeof value}`);
      }
    }
    else if (operator === 'inTuple' || operator === 'globalInTuple') {
      if (!Array.isArray(value)) {
        throw new Error(`Expected an array of tuples for ${operator} operator, but got ${typeof value}`);
      }
    }
    else if (operator === 'inSubquery' || operator === 'globalInSubquery') {
      if (typeof value !== 'string') {
        throw new Error(`Expected a string (subquery) for ${operator} operator, but got ${typeof value}`);
      }
    }
    else if (operator === 'inTable' || operator === 'globalInTable') {
      if (typeof value !== 'string') {
        throw new Error(`Expected a string (table name) for ${operator} operator, but got ${typeof value}`);
      }
    }

    const nextExpr: ExprNode = {
      kind: 'condition',
      column: columnString,
      operator,
      value: this.wrapValue(operator, value),
    };

    return {
      ...config,
      [clause]: appendExpression(config[clause], nextExpr, conjunction)
    };
  }

  addExpressionCondition(
    clause: 'where' | 'prewhere',
    conjunction: 'AND' | 'OR',
    expression: PredicateExpression
  ) {
    const config = this.builder.getConfig();

    const nextExpr: ExprNode = {
      kind: 'raw',
      expression: expression.sql,
      parameters: expression.parameters.map(value => ({ kind: 'value' as const, value })),
    };

    return {
      ...config,
      [clause]: appendExpression(config[clause], nextExpr, conjunction)
    };
  }

  addGroup(
    clause: 'where' | 'prewhere',
    conjunction: 'AND' | 'OR',
    expression: ExprNode | undefined
  ) {
    const config = this.builder.getConfig();
    const grouped: ExprNode = {
      kind: 'group',
      expression,
    };

    return {
      ...config,
      [clause]: appendExpression(config[clause], grouped, conjunction)
    };
  }
}
