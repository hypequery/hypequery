import type { SqlExpression, AliasedExpression } from '../utils/sql-expressions.js';
import type { ColumnType, InferColumnType } from '../../types/schema.js';
import type { AnyBuilderState, BaseRow, ResolveTableSchema } from './builder-state.js';
import { Simplify, UnionToIntersection } from './type-helpers.js';

type TableIdentifiers<State extends AnyBuilderState> = State['tables'] & string;

type QualifiedColumnsFor<State extends AnyBuilderState, Table extends string> =
  ResolveTableSchema<State, Table> extends Record<string, ColumnType>
    ? `${Table}.${Extract<keyof ResolveTableSchema<State, Table>, string>}`
    : never;

export type QualifiedColumnKeys<State extends AnyBuilderState> = {
  [Table in TableIdentifiers<State>]: QualifiedColumnsFor<State, Table>
}[TableIdentifiers<State>];

export type BaseColumnKeys<State extends AnyBuilderState> = keyof BaseRow<State>;
export type OutputColumnKeys<State extends AnyBuilderState> = keyof State['output'];

export type SelectableColumn<State extends AnyBuilderState> =
  | OutputColumnKeys<State>
  | BaseColumnKeys<State>
  | QualifiedColumnKeys<State>;

type StringSelectableColumn<State extends AnyBuilderState> = Extract<SelectableColumn<State>, string>;
type AsKeyword = 'as' | 'AS' | 'As' | 'aS';
type AliasedColumnString<State extends AnyBuilderState> = `${StringSelectableColumn<State>} ${AsKeyword} ${string}`;

export type SelectableItem<State extends AnyBuilderState> =
  | SelectableColumn<State>
  | AliasedColumnString<State>
  | SqlExpression;

export type ColumnSelectionKey<P> = P extends `${string}.${infer C}` ? C : P;

type QualifiedColumnValue<State extends AnyBuilderState, P> =
  P extends `${infer Table}.${infer Column}`
    ? ResolveTableSchema<State, Table> extends Record<string, ColumnType>
      ? Column extends keyof ResolveTableSchema<State, Table>
        ? ResolveTableSchema<State, Table>[Column] extends ColumnType
          ? InferColumnType<ResolveTableSchema<State, Table>[Column]>
          : never
        : never
      : never
    : never;

export type ColumnSelectionValue<State extends AnyBuilderState, P> =
  P extends OutputColumnKeys<State>
    ? State['output'][P]
    : P extends BaseColumnKeys<State>
      ? BaseRow<State>[P]
      : QualifiedColumnValue<State, P>;

export type ColumnSelectionRecord<
  State extends AnyBuilderState,
  K
> = {
  [P in Extract<K, SelectableColumn<State>> as ColumnSelectionKey<P>]: ColumnSelectionValue<State, P>;
};

type ParsedAliasedColumn<
  State extends AnyBuilderState,
  Entry extends string
> = Entry extends `${infer Column} ${infer Keyword} ${infer Alias}`
  ? Lowercase<Keyword> extends 'as'
    ? Column extends StringSelectableColumn<State>
      ? { [P in Alias]: ColumnSelectionValue<State, Column> }
      : {}
    : {}
  : {};

type AliasedColumnSelectionRecord<
  State extends AnyBuilderState,
  K
> = [Extract<K, string>] extends [never]
  ? {}
  : UnionToIntersection<ParsedAliasedColumn<State, Extract<K, string>>>;

export type ExpressionSelectionRecord<K> = UnionToIntersection<
  K extends AliasedExpression<infer R, infer A> ? { [P in A]: R } : {}
>;

export type SelectionResult<
  State extends AnyBuilderState,
  K
> = Simplify<
  ColumnSelectionRecord<State, K>
  & ExpressionSelectionRecord<K>
  & AliasedColumnSelectionRecord<State, K>
>;
