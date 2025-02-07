export type ColumnType = 'Int32' | 'String' | 'Float64' | 'Date' | 'DateTime' | 'Int64';

export interface TableSchema<T> {
  name: string;
  columns: T;
}

export type DatabaseSchema = Record<string, Record<string, ColumnType>>;

export type SelectExpression<T> = keyof T | number | { [alias: string]: string };
export type WhereExpression = string;
export type GroupByExpression<T> = keyof T | Array<keyof T>;

export type ColumnToTS<T> = T extends 'String' ? string :
  T extends 'Date' ? Date :
  T extends 'Float64' | 'Int32' | 'Int64' ? number :
  never;

export type OrderDirection = 'ASC' | 'DESC';

export type JoinType = 'INNER' | 'LEFT' | 'RIGHT' | 'FULL';

export interface JoinClause {
  type: JoinType;
  table: string;
  leftColumn: string;
  rightColumn: string;
  alias?: string;
}

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

export type InferColumnType<T extends ColumnType> =
  T extends 'String' ? string :
  T extends 'Int32' | 'Int64' ? number :
  T extends 'Float64' ? number :
  T extends 'DateTime' | 'Date' ? Date :
  T extends `Array(${infer U extends ColumnType})` ? Array<InferColumnType<U>> :
  never;

export type TableRecord<T> = {
  [K in keyof T]: T[K] extends ColumnType ? InferColumnType<T[K]> : never;
};

export type SelectedRecord<T, K extends keyof T> = {
  [P in K]: T[P] extends ColumnType ? InferColumnType<T[P]> : never;
};

export type TransformedColumns<T, K extends keyof T> = {
  [P in K]: T[P] extends 'String' ? string :
  T[P] extends 'Date' ? Date :
  T[P] extends 'Float64' | 'Int32' | 'Int64' ? number : never;
};

export type AggregateColumn<T, A extends keyof T, Type extends string> = {
  [P in `${string & A}_${Type}`]: string;
};

export type FilterOperator =
  | 'eq' | 'neq' | 'gt' | 'gte' | 'lt' | 'lte'
  | 'like' | 'in' | 'notIn' | 'between';

export interface WhereCondition {
  column: string;
  operator: FilterOperator;
  value: any;
  conjunction: 'AND' | 'OR';
}

export type TableColumn<Schema> = {
  [Table in keyof Schema]: `${string & Table}.${string & keyof Schema[Table]}`
}[keyof Schema] | keyof Schema[keyof Schema];
