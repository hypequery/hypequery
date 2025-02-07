export type ColumnType = 'Int32' | 'String' | 'Float64' | 'Date' | 'DateTime' | 'Int64';

export type OrderDirection = 'ASC' | 'DESC';

export interface WhereCondition {
  column: string;
  operator: FilterOperator;
  value: any;
  conjunction: 'AND' | 'OR';
}

export type FilterOperator =
  | 'eq' | 'neq' | 'gt' | 'gte' | 'lt' | 'lte'
  | 'like' | 'in' | 'notIn' | 'between';

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

export type InferColumnType<T extends ColumnType> =
  T extends 'String' ? string :
  T extends 'Int32' | 'Int64' ? number :
  T extends 'Float64' ? number :
  T extends 'DateTime' | 'Date' ? Date :
  T extends `Array(${infer U extends ColumnType})` ? Array<InferColumnType<U>> :
  never;

export type AggregationType<T, Aggregations, Column, A extends string, Suffix extends string, HasSelect extends boolean> =
  HasSelect extends true
  ? { [K in keyof T | A]: K extends keyof T ? T[K] : string }
  : Aggregations extends Record<string, string>
  ? Aggregations & Record<A extends undefined ? `${Column & string}_${Suffix}` : A, string>
  : Record<A extends undefined ? `${Column & string}_${Suffix}` : A, string>;
