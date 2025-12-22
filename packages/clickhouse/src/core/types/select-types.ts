import type { SqlExpression, AliasedExpression } from '../utils/sql-expressions.js';
import type { ColumnType, InferColumnType, TableColumnForTables } from '../../types/schema.js';
import type { AnyBuilderState, BaseRow } from './builder-state.js';
import { Simplify, UnionToIntersection } from './type-helpers.js';

export type QualifiedColumnKeys<State extends AnyBuilderState> = Extract<
  TableColumnForTables<State['schema'], State['tables']>,
  `${string}.${string}`
>;

export type BaseColumnKeys<State extends AnyBuilderState> = keyof BaseRow<State>;
export type OutputColumnKeys<State extends AnyBuilderState> = keyof State['output'];

export type SelectableColumn<State extends AnyBuilderState> =
  | OutputColumnKeys<State>
  | BaseColumnKeys<State>
  | QualifiedColumnKeys<State>;

export type SelectableItem<State extends AnyBuilderState> =
  | SelectableColumn<State>
  | SqlExpression;

export type ColumnSelectionKey<P> = P extends `${string}.${infer C}` ? C : P;

export type ColumnSelectionValue<State extends AnyBuilderState, P> =
  P extends OutputColumnKeys<State>
    ? State['output'][P]
    : P extends BaseColumnKeys<State>
      ? BaseRow<State>[P]
      : P extends `${infer Table}.${infer Column}`
        ? Table extends State['tables']
          ? Column extends keyof State['schema'][Table]
            ? State['schema'][Table][Column] extends ColumnType
              ? InferColumnType<State['schema'][Table][Column]>
              : never
            : never
          : never
        : never;

export type ColumnSelectionRecord<
  State extends AnyBuilderState,
  K
> = {
  [P in Extract<K, SelectableColumn<State>> as ColumnSelectionKey<P>]: ColumnSelectionValue<State, P>;
};

export type ExpressionSelectionRecord<K> = UnionToIntersection<
  K extends AliasedExpression<infer R, infer A> ? { [P in A]: R } : {}
>;

export type SelectionResult<
  State extends AnyBuilderState,
  K
> = Simplify<ColumnSelectionRecord<State, K> & ExpressionSelectionRecord<K>>;
