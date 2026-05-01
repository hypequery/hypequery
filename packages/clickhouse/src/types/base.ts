import type { ClickHouseSettings } from '@clickhouse/client-common';
import { FilterOperator } from "./filters.js";
import type { TableColumn } from './schema.js';

export interface QueryConfig<T, Schema> {
  select?: SelectionNode[];
  from?: SourceNode;
  prewhere?: ExprNode;
  where?: ExprNode;
  groupBy?: GroupByItemNode[];
  having?: HavingNode[];
  limit?: number;
  offset?: number;
  distinct?: boolean;
  orderBy?: OrderByItemNode[];
  joins?: JoinNode[];
  ctes?: CteNode[];
  unionQueries?: string[];
  settings?: ClickHouseSettings;
}

export type { ColumnType, TableSchema, DatabaseSchema, TableRecord, InferColumnType, TableColumn } from './schema.js';

export type WhereExpression = string;
export type GroupByExpression<T> = keyof T | Array<keyof T>;

export type OrderDirection = 'ASC' | 'DESC';

export interface CompiledQuery {
  query: string;
  parameters: unknown[];
}

export interface SelectionNode {
  kind: 'selection';
  selection: string;
}

export interface ValueNode {
  kind: 'value';
  value: unknown;
}

export type ConditionValueNode =
  | ValueNode
  | ValueNode[]
  | ValueNode[][]
  | [ValueNode, ValueNode]
  | string;

export interface ConditionExprNode {
  kind: 'condition';
  column: string;
  operator: FilterOperator;
  value: ConditionValueNode;
}

export interface RawExprNode {
  kind: 'raw';
  expression: string;
  parameters: ValueNode[];
}

export interface LogicalExprNode {
  kind: 'logical';
  operator: 'AND' | 'OR';
  conditions: ExprNode[];
}

export interface SequenceExprNode {
  kind: 'sequence';
  items: Array<{
    conjunction?: 'AND' | 'OR';
    expression: ExprNode;
  }>;
}

export interface GroupExprNode {
  kind: 'group';
  expression?: ExprNode;
}

export type ExprNode = ConditionExprNode | RawExprNode | LogicalExprNode | SequenceExprNode | GroupExprNode;

export interface TableSourceNode {
  kind: 'table';
  name: string;
  final?: boolean;
}

export type SourceNode = TableSourceNode;

export interface GroupByItemNode {
  kind: 'group-by-item';
  expression: string;
}

export interface HavingNode {
  kind: 'having';
  expression: string;
  parameters?: ValueNode[];
}

export type JoinType = 'INNER' | 'LEFT' | 'RIGHT' | 'FULL';

export interface JoinNode {
  kind: 'join';
  type: JoinType;
  table: string;
  leftColumn: string;
  rightColumn: string;
  alias?: string;
}

export interface OrderByItemNode {
  kind: 'order-by-item';
  column: string;
  direction: OrderDirection;
}

export interface CteNode {
  kind: 'cte';
  expression: string;
}

export interface SelectQueryNode<T, Schema> extends QueryConfig<T, Schema> {
  kind: 'select-query';
}

export type AggregationType<T, Aggregations, Column, A extends string, Suffix extends string, HasSelect extends boolean> =
  HasSelect extends true
  ? { [K in keyof T | A]: K extends keyof T ? T[K] : string }
  : Aggregations extends Record<string, string>
  ? Aggregations & Record<A extends undefined ? `${Column & string}_${Suffix}` : A, string>
  : Record<A extends undefined ? `${Column & string}_${Suffix}` : A, string>;
