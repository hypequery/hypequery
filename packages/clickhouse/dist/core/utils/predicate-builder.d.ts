import type { AnyBuilderState, BaseRow } from '../types/builder-state.js';
import type { SelectableColumn } from '../types/select-types.js';
export type PredicatePrimitive = string | number | boolean | Date | null;
type PredicateValue = Exclude<PredicatePrimitive, string>;
export interface PredicateExpression<T = unknown> {
    __type: 'predicate_expression';
    sql: string;
    parameters: any[];
    readonly expressionType?: T | undefined;
}
export interface PredicateLiteral<T = PredicatePrimitive> {
    __type: 'predicate_literal';
    value: T;
}
export type ColumnReference<State extends AnyBuilderState> = keyof BaseRow<State> | keyof State['output'] | Extract<SelectableColumn<State>, string>;
export type PredicateArg<State extends AnyBuilderState> = ColumnReference<State> | PredicateExpression | PredicateLiteral | PredicateValue | PredicatePrimitive[];
export interface PredicateBuilder<State extends AnyBuilderState> {
    fn<T = unknown>(name: string, ...args: Array<PredicateArg<State>>): PredicateExpression<T>;
    col(column: ColumnReference<State>): PredicateExpression;
    value<T extends PredicatePrimitive>(value: T): PredicateLiteral<T>;
    literal<T extends PredicatePrimitive>(value: T): PredicateLiteral<T>;
    array(values: Array<PredicatePrimitive | PredicateLiteral>): PredicateExpression;
    raw(sql: string): PredicateExpression;
    and(expressions: PredicateExpression[]): PredicateExpression<boolean>;
    or(expressions: PredicateExpression[]): PredicateExpression<boolean>;
}
export declare function createPredicateBuilder<State extends AnyBuilderState>(): PredicateBuilder<State>;
export {};
//# sourceMappingURL=predicate-builder.d.ts.map