import { ClickHouseType, InferClickHouseType } from './clickhouse-types.js';

export type ColumnType = ClickHouseType;

export type InferColumnType<T extends ColumnType> = InferClickHouseType<T>;

export type DatabaseSchema = Record<string, Record<string, ColumnType>>;

export type AnySchema = Record<string, Record<string, ColumnType>>;

export interface TableSchema<TColumns> {
  name: string;
  columns: TColumns;
}

export type TableRecord<TColumns> = {
  [K in keyof TColumns]: InferColumnType<Extract<TColumns[K], ColumnType>>;
};

export type QualifiedColumn<Schema, TableName extends keyof Schema> =
  `${string & TableName}.${string & keyof Schema[TableName]}`;

export type ColumnIdentifier<Schema, TableName extends keyof Schema> =
  QualifiedColumn<Schema, TableName> | keyof Schema[TableName];

export type TableColumnForTables<Schema, Tables extends keyof Schema = keyof Schema> = {
  [TableName in Tables]: ColumnIdentifier<Schema, TableName>;
}[Tables];

export type TableColumn<Schema> = TableColumnForTables<Schema>;
