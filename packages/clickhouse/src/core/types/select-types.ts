import type { SqlExpression, AliasedExpression } from '../utils/sql-expressions.js';
import type { ColumnType, InferColumnType, TableColumn } from '../../types/schema.js';
import { Simplify, UnionToIntersection } from './type-helpers.js';

export type SelectableItem<
  Schema extends { [K in keyof Schema]: { [columnName: string]: ColumnType } },
  T,
  VisibleTables extends keyof Schema
> = keyof T | TableColumn<Schema> | SqlExpression;

export type ColumnSelectionRecord<
  Schema extends { [K in keyof Schema]: { [columnName: string]: ColumnType } },
  T,
  VisibleTables extends keyof Schema,
  K
> = {
  [P in Extract<K, keyof T | TableColumn<Schema>> as P extends `${string}.${infer C}` ? C : P]:
  P extends keyof T
    ? T[P] extends ColumnType
      ? InferColumnType<T[P]>
      : unknown
    : string;
};

export type ExpressionSelectionRecord<K> = UnionToIntersection<
  K extends AliasedExpression<infer R, infer A> ? { [P in A]: R } : {}
>;

export type SelectionResult<
  Schema extends { [K in keyof Schema]: { [columnName: string]: ColumnType } },
  T,
  VisibleTables extends keyof Schema,
  K
> = Simplify<ColumnSelectionRecord<Schema, T, VisibleTables, K> & ExpressionSelectionRecord<K>>;
