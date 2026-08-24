import type { ColumnType, InferColumnType, TableRecord } from '../../types/schema.js';
import type { InsertRow } from '../../types/insert.js';
import type { Simplify } from './type-helpers.js';

export type SchemaDefinition<Schema extends Record<string, any> = Record<string, any>> = {
  [K in keyof Schema]: Record<string, ColumnType>;
};

export const SUBQUERY_SOURCE_TABLE = '__hypequery_internal_subquery_source__' as const;

export type BuilderState<
  Schema extends SchemaDefinition<Schema>,
  VisibleTables extends string,
  OutputRow,
  BaseTable extends keyof Schema,
  Aliases extends Partial<Record<string, keyof Schema>> = {},
  Scalars extends Record<string, unknown> = {},
  BaseShape extends Record<string, unknown> = Schema[BaseTable]
> = {
  schema: Schema;
  tables: VisibleTables;
  output: OutputRow;
  baseTable: BaseTable;
  base: BaseShape;
  aliases: Aliases;
  scalars: Scalars;
};

export type AnyBuilderState = BuilderState<any, any, any, any, any, any, any>;

export type BaseRow<State extends AnyBuilderState> = Simplify<{
  [K in keyof State['base']]: State['base'][K] extends ColumnType
  ? InferColumnType<State['base'][K]>
  : State['base'][K];
}>;

export type WidenTables<
  State extends AnyBuilderState,
  Table extends keyof State['schema']
> = BuilderState<
  State['schema'],
  State['tables'] | (Table & string),
  State['output'],
  State['baseTable'],
  State['aliases'],
  State['scalars'],
  State['base']
>;

export type UpdateOutput<
  State extends AnyBuilderState,
  Output
> = BuilderState<
  State['schema'],
  State['tables'],
  Output,
  State['baseTable'],
  State['aliases'],
  State['scalars'],
  State['base']
>;

export type InitialState<
  Schema extends SchemaDefinition<Schema>,
  Table extends keyof Schema
> = BuilderState<Schema, Table & string, TableRecord<Schema[Table]>, Table, {}, {}>;

export type ExplicitSelectionState<State extends AnyBuilderState> =
  BaseRow<State> extends State['output']
  ? State['output'] extends BaseRow<State>
  ? false
  : true
  : true;

export type AppendToOutput<
  State extends AnyBuilderState,
  Added
> = UpdateOutput<
  State,
  ExplicitSelectionState<State> extends true
  ? Simplify<State['output'] & Added>
  : Simplify<Added>
>;

export type AddAlias<
  State extends AnyBuilderState,
  Alias extends string,
  Table extends keyof State['schema']
> = BuilderState<
  State['schema'],
  State['tables'] | Alias,
  State['output'],
  State['baseTable'],
  State['aliases'] & Record<Alias, Table>,
  State['scalars'],
  State['base']
>;

export type AddScalar<
  State extends AnyBuilderState,
  Alias extends string,
  Value
> = BuilderState<
  State['schema'],
  State['tables'],
  State['output'],
  State['baseTable'],
  State['aliases'],
  State['scalars'] & Record<Alias, Value>,
  State['base']
>;

export type FromSubqueryState<
  Schema extends SchemaDefinition<Schema>,
  SubqueryState extends BuilderState<Schema, string, any, keyof Schema, any, any, any>
> = BuilderState<
  Schema,
  typeof SUBQUERY_SOURCE_TABLE,
  SubqueryState['output'],
  SubqueryState['baseTable'],
  {},
  {},
  SubqueryState['output']
>;

export type InsertState<
  Schema extends SchemaDefinition<Schema>,
  Table extends keyof Schema,
  Row
> = {
  schema: Schema;
  table: Table;
  row: Row;
};

export type AnyInsertState = InsertState<any, any, any>;

export type InitialInsertState<
  Schema extends SchemaDefinition<Schema>,
  Table extends keyof Schema
> = InsertState<Schema, Table, InsertRow<Schema[Table]>>;

export type UpdateInsertRow<
  State extends AnyInsertState,
  Row
> = InsertState<State['schema'], State['table'], Row>;

export type ResolveTableSchema<
  State extends AnyBuilderState,
  Table extends string
> = Table extends keyof State['schema']
  ? State['schema'][Table]
  : Table extends keyof State['aliases']
  ? State['schema'][State['aliases'][Table]]
  : never;
