import { ClickHouseType, InferClickHouseType } from "./clickhouse-types.js";
import { FilterOperator } from "./filters.js";

export interface QueryConfig<T, Schema> {
  select?: Array<keyof T | string>;
  where?: WhereCondition[];
  groupBy?: string[];
  having?: string[];
  limit?: number;
  offset?: number;
  distinct?: boolean;
  orderBy?: Array<{
    column: keyof T | TableColumn<Schema>;
    direction: OrderDirection;
  }>;
  joins?: JoinClause[];
  parameters?: any[];
  ctes?: string[];
  unionQueries?: string[];
  settings?: string;
}

export interface TableSchema<T> {
  name: string;
  columns: T;
}

// Support for cross-database schemas
export type DatabaseSchema = Record<string, Record<string, ColumnType>>;

// Cross-database schema structure - using a more explicit approach
export interface CrossDatabaseSchema {
  // Default database tables (backward compatible)
  [tableName: string]: Record<string, ColumnType>;
}

// Separate interface for cross-database support
export interface CrossDatabaseSupport {
  __databases: {
    [databaseName: string]: {
      [tableName: string]: Record<string, ColumnType>;
    };
  };
}

// Combined schema type that can include cross-database support
export type SchemaWithCrossDatabase<Schema extends CrossDatabaseSchema> = Schema & CrossDatabaseSupport;

// Type guard to check if a schema supports cross-database
export type HasCrossDatabaseSupport<Schema> = Schema extends CrossDatabaseSupport ? true : false;

// Helper type for schema constraints that support cross-database tables
export type SchemaWithCrossDatabaseSupport = {
  [K in keyof any]: K extends '__databases'
  ? { [databaseName: string]: { [tableName: string]: { [columnName: string]: ColumnType } } }
  : { [columnName: string]: ColumnType }
};

export type WhereExpression = string;
export type GroupByExpression<T> = keyof T | Array<keyof T>;
export type TableRecord<T> = {
  [K in keyof T]: T[K] extends ColumnType ? InferColumnType<T[K]> : never;
};

// Replace the old ColumnType with the new one
export type ColumnType = ClickHouseType;

// Update InferColumnType to use the new InferClickHouseType
export type InferColumnType<T extends ColumnType> = InferClickHouseType<T>;

export type OrderDirection = 'ASC' | 'DESC';

export interface WhereCondition {
  column: string;
  operator: FilterOperator;
  value: any;
  conjunction: 'AND' | 'OR';
  type?: 'condition' | 'group-start' | 'group-end';
}

export type JoinType = 'INNER' | 'LEFT' | 'RIGHT' | 'FULL';

export interface JoinClause {
  type: JoinType;
  table: string;
  leftColumn: string;
  rightColumn: string;
  alias?: string;
}

// Enhanced TableColumn type to support cross-database references
export type TableColumn<Schema> =
  // Regular table columns
  | {
    [Table in keyof Schema]: `${string & Table}.${string & keyof Schema[Table]}`
  }[keyof Schema]
  | (keyof Schema extends string ? keyof Schema[keyof Schema] : never)
  // Cross-database table columns
  | (Schema extends CrossDatabaseSupport
    ? Schema['__databases'] extends Record<string, any>
    ? {
      [DB in keyof Schema['__databases']]: {
        [Table in keyof Schema['__databases'][DB]]:
        `${string & DB}.${string & Table}.${string & keyof Schema['__databases'][DB][Table]}`
      }[keyof Schema['__databases'][DB]]
    }[keyof Schema['__databases']]
    : never
    : never);

// Enhanced table reference type for joins
export type TableReference<Schema> =
  | keyof Schema
  | (Schema extends CrossDatabaseSupport
    ? Schema['__databases'] extends Record<string, any>
    ? {
      [DB in keyof Schema['__databases']]: `${string & DB}.${string & keyof Schema['__databases'][DB]}`
    }[keyof Schema['__databases']]
    : never
    : never)

export type AggregationType<T, Aggregations, Column, A extends string, Suffix extends string, HasSelect extends boolean> =
  HasSelect extends true
  ? { [K in keyof T | A]: K extends keyof T ? T[K] : string }
  : Aggregations extends Record<string, string>
  ? Aggregations & Record<A extends undefined ? `${Column & string}_${Suffix}` : A, string>
  : Record<A extends undefined ? `${Column & string}_${Suffix}` : A, string>;

export interface PaginationOptions<T> {
  pageSize: number;
  after?: string;
  before?: string;
  orderBy?: Array<{
    column: keyof T | TableColumn<any>;
    direction: OrderDirection;
  }>;
}

export interface PageInfo {
  hasNextPage: boolean;
  hasPreviousPage: boolean;
  startCursor: string;
  endCursor: string;
  totalCount: number;
  totalPages: number;
  pageSize: number;
}

export interface PaginatedResult<T> {
  data: T[];
  pageInfo: PageInfo;
}
