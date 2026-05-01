import type { ClickHouseSettings } from '@clickhouse/client-common';
import type {
  ConditionValueNode,
  ExprNode,
  FilterOperator,
  JoinType,
  OrderDirection,
  SelectQueryNode,
  ValueNode,
} from '../../types/index.js';

export type LegacyStandardWhereCondition = {
  column: string;
  operator: FilterOperator;
  value: any;
  conjunction: 'AND' | 'OR';
  type?: 'condition' | 'group-start' | 'group-end';
};

export type LegacyExpressionWhereCondition = {
  type: 'expression';
  expression: string;
  parameters: any[];
  conjunction: 'AND' | 'OR';
};

export type LegacyWhereCondition = LegacyStandardWhereCondition | LegacyExpressionWhereCondition;

export type LegacyQueryConfig<T> = {
  select?: Array<keyof T | string>;
  from?: { kind: 'table'; name: string; final?: boolean };
  where?: LegacyWhereCondition[];
  prewhere?: LegacyWhereCondition[];
  groupBy?: string[];
  having?: string[];
  limit?: number;
  offset?: number;
  distinct?: boolean;
  orderBy?: Array<{
    column: keyof T | string;
    direction: OrderDirection;
  }>;
  joins?: Array<{
    type: JoinType;
    table: string;
    leftColumn: string;
    rightColumn: string;
    alias?: string;
  }>;
  parameters?: any[];
  ctes?: string[];
  unionQueries?: string[];
  settings?: ClickHouseSettings;
};

function unwrapValueNode(value: ValueNode): any {
  return value.value;
}

function unwrapConditionValue(value: ConditionValueNode): any {
  if (typeof value === 'string') {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map(item => Array.isArray(item) ? item.map(unwrapValueNode) : unwrapValueNode(item));
  }

  return unwrapValueNode(value);
}

function collectExprParameters(expr?: ExprNode): any[] {
  if (!expr) return [];

  switch (expr.kind) {
    case 'condition': {
      const value = unwrapConditionValue(expr.value);
      if (expr.operator === 'between') {
        return Array.isArray(value) ? value : [];
      }
      if (
        expr.operator === 'in' ||
        expr.operator === 'notIn' ||
        expr.operator === 'globalIn' ||
        expr.operator === 'globalNotIn'
      ) {
        return Array.isArray(value) ? value : [];
      }
      if (expr.operator === 'inTuple' || expr.operator === 'globalInTuple') {
        return Array.isArray(value) ? value.flat() : [];
      }
      if (
        expr.operator === 'inSubquery' ||
        expr.operator === 'globalInSubquery' ||
        expr.operator === 'inTable' ||
        expr.operator === 'globalInTable' ||
        expr.operator === 'isNull' ||
        expr.operator === 'isNotNull'
      ) {
        return [];
      }
      return [value];
    }
    case 'raw':
      return expr.parameters.map(unwrapValueNode);
    case 'group':
      return collectExprParameters(expr.expression);
    case 'logical':
      return expr.conditions.flatMap(condition => collectExprParameters(condition));
    case 'sequence':
      return expr.items.flatMap(item => collectExprParameters(item.expression));
    default:
      return [];
  }
}

function flattenExprToLegacyConditions(
  expr: ExprNode | undefined,
  firstConjunction: 'AND' | 'OR' = 'AND'
): LegacyWhereCondition[] {
  if (!expr) return [];

  switch (expr.kind) {
    case 'condition':
      return [{
        column: expr.column,
        operator: expr.operator,
        value: unwrapConditionValue(expr.value),
        conjunction: firstConjunction,
      }];
    case 'raw':
      return [{
        type: 'expression',
        expression: expr.expression,
        parameters: expr.parameters.map(unwrapValueNode),
        conjunction: firstConjunction,
      }];
    case 'group': {
      if (!expr.expression) return [];
      return [
        {
          column: '',
          operator: 'eq',
          value: null,
          conjunction: firstConjunction,
          type: 'group-start',
        },
        ...flattenExprToLegacyConditions(expr.expression, 'AND'),
        {
          column: '',
          operator: 'eq',
          value: null,
          conjunction: 'AND',
          type: 'group-end',
        },
      ];
    }
    case 'sequence':
      return expr.items.flatMap((item, index) =>
        flattenExprToLegacyConditions(
          item.expression,
          index === 0 ? firstConjunction : (item.conjunction || 'AND')
        )
      );
    case 'logical':
      return flattenExprToLegacyConditions(
        {
          kind: 'sequence',
          items: expr.conditions.map((condition, index) => ({
            conjunction: index === 0 ? undefined : expr.operator,
            expression: condition,
          })),
        },
        firstConjunction
      );
    default:
      return [];
  }
}

export function toLegacyQueryConfig<T, Schema>(
  queryNode: SelectQueryNode<T, Schema>
): LegacyQueryConfig<T> {
  return {
    select: queryNode.select?.map(item => item.selection) as Array<keyof T | string> | undefined,
    from: queryNode.from ? { ...queryNode.from } : undefined,
    where: flattenExprToLegacyConditions(queryNode.where),
    prewhere: flattenExprToLegacyConditions(queryNode.prewhere),
    groupBy: queryNode.groupBy?.map(item => item.expression),
    having: queryNode.having?.map(item => item.expression),
    limit: queryNode.limit,
    offset: queryNode.offset,
    distinct: queryNode.distinct,
    orderBy: queryNode.orderBy?.map(item => ({
      column: item.column as keyof T | string,
      direction: item.direction,
    })),
    joins: queryNode.joins?.map(join => ({
      type: join.type,
      table: join.table,
      leftColumn: join.leftColumn,
      rightColumn: join.rightColumn,
      alias: join.alias,
    })),
    parameters: [
      ...collectExprParameters(queryNode.prewhere),
      ...collectExprParameters(queryNode.where),
      ...(queryNode.having?.flatMap(item => item.parameters?.map(unwrapValueNode) || []) || []),
    ],
    ctes: queryNode.ctes?.map(item => item.expression),
    unionQueries: queryNode.unionQueries ? [...queryNode.unionQueries] : undefined,
    settings: queryNode.settings ? { ...queryNode.settings } : undefined,
  };
}
