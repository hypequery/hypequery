/** What dataset generation needs to know about a database schema, engine by engine. */

export type GeneratedDimensionType = 'string' | 'number' | 'boolean' | 'timestamp';

export interface IntrospectedTable {
  /** The dataset name and registry key: a plain identifier. */
  readonly name: string;
  /** The physical source a dataset reads (`orders`, `analytics.orders`). */
  readonly source: string;
}

export interface IntrospectedColumn {
  readonly name: string;
  /** The engine's own type, as introspection reported it. */
  readonly type: string;
  readonly dimensionType: GeneratedDimensionType;
  /** A numeric type, so the column may be a measure. */
  readonly numeric: boolean;
  /** A date or time type, so the column may be the time key. */
  readonly temporal: boolean;
}

/** A single-column foreign key from one introspected table to another. */
export interface IntrospectedForeignKey {
  readonly column: string;
  readonly target: string;
  readonly targetColumn: string;
}

export interface SchemaIntrospector {
  /** Display name for messages and the generated file header. */
  readonly engine: string;
  listTables(): Promise<IntrospectedTable[]>;
  describeTable(table: IntrospectedTable): Promise<IntrospectedColumn[]>;
  /** Foreign keys whose source and target are both in *tables*, by source table name. */
  foreignKeys?(tables: readonly IntrospectedTable[]): Promise<Map<string, IntrospectedForeignKey[]>>;
}
