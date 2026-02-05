import type { ColumnType, InferColumnType, TableRecord } from '../../types/schema.js';
import type { Simplify } from './type-helpers.js';
export type SchemaDefinition<Schema extends Record<string, any> = Record<string, any>> = {
    [K in keyof Schema]: Record<string, ColumnType>;
};
export type BuilderState<Schema extends SchemaDefinition<Schema>, VisibleTables extends string, OutputRow, BaseTable extends keyof Schema, Aliases extends Partial<Record<string, keyof Schema>> = {}> = {
    schema: Schema;
    tables: VisibleTables;
    output: OutputRow;
    baseTable: BaseTable;
    base: Schema[BaseTable];
    aliases: Aliases;
};
export type AnyBuilderState = BuilderState<any, any, any, any, any>;
export type BaseRow<State extends AnyBuilderState> = Simplify<{
    [K in keyof State['base']]: State['base'][K] extends ColumnType ? InferColumnType<State['base'][K]> : never;
}>;
export type WidenTables<State extends AnyBuilderState, Table extends keyof State['schema']> = BuilderState<State['schema'], State['tables'] | (Table & string), State['output'], State['baseTable'], State['aliases']>;
export type UpdateOutput<State extends AnyBuilderState, Output> = BuilderState<State['schema'], State['tables'], Output, State['baseTable'], State['aliases']>;
export type InitialState<Schema extends SchemaDefinition<Schema>, Table extends keyof Schema> = BuilderState<Schema, Table & string, TableRecord<Schema[Table]>, Table, {}>;
export type ExplicitSelectionState<State extends AnyBuilderState> = BaseRow<State> extends State['output'] ? State['output'] extends BaseRow<State> ? false : true : true;
export type AppendToOutput<State extends AnyBuilderState, Added> = UpdateOutput<State, ExplicitSelectionState<State> extends true ? Simplify<State['output'] & Added> : Simplify<Added>>;
export type AddAlias<State extends AnyBuilderState, Alias extends string, Table extends keyof State['schema']> = BuilderState<State['schema'], State['tables'] | Alias, State['output'], State['baseTable'], State['aliases'] & Record<Alias, Table>>;
export type ResolveTableSchema<State extends AnyBuilderState, Table extends string> = Table extends keyof State['schema'] ? State['schema'][Table] : Table extends keyof State['aliases'] ? State['schema'][State['aliases'][Table]] : never;
//# sourceMappingURL=builder-state.d.ts.map