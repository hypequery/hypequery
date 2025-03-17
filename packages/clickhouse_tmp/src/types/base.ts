import { ClickHouseType, InferClickHouseType } from "./clickhouse-types";
import { FilterOperator } from "./filters";

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

export type DatabaseSchema = Record<string, Record<string, ColumnType>>;
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
}

export type JoinType = 'INNER' | 'LEFT' | 'RIGHT' | 'FULL';

export interface JoinClause {
  type: JoinType;
  table: string;
  leftColumn: string;
  rightColumn: string;
  alias?: string;
}

export type TableColumn<Schema> = {
  [Table in keyof Schema]: `${string & Table}.${string & keyof Schema[Table]}`
}[keyof Schema] | keyof Schema[keyof Schema];


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
