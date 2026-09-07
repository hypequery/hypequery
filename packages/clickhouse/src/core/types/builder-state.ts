import type { ColumnType, InferColumnType, TableRecord } from '../../types/schema.js';
import type { InsertRow } from '../../types/insert.js';
import type { Simplify } from './type-helpers.js';

export type SchemaDefinition<Schema extends Record<string, any> = Record<string, any>> = {
  [K in keyof Schema]: Record<string, ColumnType>;
};

export const SUBQUERY_SOURCE_TABLE = '__hypequery_internal_subquery_source__' as const;

/**
 * The columns a source exposes. Either schema-style `ColumnType` strings
 * (`{ id: 'UUID' }`) or an already-resolved row type (`{ id: string }`), which
 * is what a CTE built from another builder carries.
 */
export type ColumnShape = Record<string, unknown>;

export type CteShapes = Record<string, ColumnShape>;

export type BuilderState<
  Schema extends SchemaDefinition<Schema>,
  VisibleTables extends string,
  OutputRow,
  BaseTable extends keyof Schema,
  Aliases extends Partial<Record<string, keyof Schema>> = {},
  Scalars extends Record<string, unknown> = {},
  BaseShape extends Record<string, unknown> = Schema[BaseTable],
  Ctes extends CteShapes = {}
> = {
  schema: Schema;
  tables: VisibleTables;
  output: OutputRow;
  baseTable: BaseTable;
  base: BaseShape;
  aliases: Aliases;
  scalars: Scalars;
  /**
   * CTE aliases declared on this query, with the columns each exposes.
   * Optional so hand-constructed states stay valid.
   */
  ctes?: Ctes;
};

export type AnyBuilderState = BuilderState<any, any, any, any, any, any, any, any>;

/**
 * Resolves a column shape to the row type it produces. `ColumnType` strings are
 * inferred; anything else is already a TypeScript type and passes through.
 */
export type RowFromShape<Shape> = Simplify<{
  [K in keyof Shape]: Shape[K] extends ColumnType
  ? InferColumnType<Shape[K]>
  : Shape[K];
}>;

export type BaseRow<State extends AnyBuilderState> = RowFromShape<State['base']>;

/** The CTE map, with the optionality of the state field resolved away. */
export type StateCtes<State extends AnyBuilderState> = NonNullable<State['ctes']>;

export type CteNames<State extends AnyBuilderState> = Extract<keyof StateCtes<State>, string>;

/** Tables a join may target: schema tables plus CTEs declared on this query. */
export type JoinableTable<State extends AnyBuilderState> =
  | Extract<keyof State['schema'], string>
  | CteNames<State>;

export type WidenTables<
  State extends AnyBuilderState,
  Table extends keyof State['schema'] | CteNames<State>
> = BuilderState<
  State['schema'],
  State['tables'] | (Table & string),
  State['output'],
  State['baseTable'],
  State['aliases'],
  State['scalars'],
  State['base'],
  StateCtes<State>
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
  State['base'],
  StateCtes<State>
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
  State['base'],
  StateCtes<State>
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
  State['base'],
  StateCtes<State>
>;

/** Columns accepted for a join's right-hand side, qualified by table or CTE. */
export type JoinRightColumn<
  State extends AnyBuilderState,
  Table extends JoinableTable<State>
> = `${Table}.${Extract<keyof ResolveTableSchema<State, Table>, string>}`;

/**
 * Joining a CTE cannot take a table alias: aliases resolve through the schema,
 * and a CTE has no schema entry to resolve to.
 */
export type JoinAliasArg<
  State extends AnyBuilderState,
  Table extends JoinableTable<State>,
  Alias
> = Table extends CteNames<State> ? undefined : Alias;

export type JoinResultState<
  State extends AnyBuilderState,
  Table extends JoinableTable<State>,
  Alias
> = Alias extends string
  ? AddAlias<WidenTables<State, Table>, Alias, Extract<Table, keyof State['schema']>>
  : WidenTables<State, Table>;

/**
 * Registers a CTE alias and the columns it exposes. The alias only becomes
 * selectable once the query joins it, which mirrors SQL scoping.
 */
export type AddCte<
  State extends AnyBuilderState,
  Alias extends string,
  Columns extends ColumnShape
> = BuilderState<
  State['schema'],
  State['tables'],
  State['output'],
  State['baseTable'],
  State['aliases'],
  State['scalars'],
  State['base'],
  StateCtes<State> & Record<Alias, Columns>
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

/**
 * Resolves an identifier used in a query to the columns it exposes. CTEs are
 * checked first because a CTE shadows a table of the same name in SQL.
 */
export type ResolveTableSchema<
  State extends AnyBuilderState,
  Table extends string
> = Table extends keyof StateCtes<State>
  ? StateCtes<State>[Table]
  : Table extends keyof State['schema']
  ? State['schema'][Table]
  : Table extends keyof State['aliases']
  ? State['schema'][State['aliases'][Table]]
  : never;
