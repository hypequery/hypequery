import { SchemaWithCrossDatabaseSupport, TableColumn } from "./base.js";

export type FilterValue<T> =
  T extends Date ? Date | string :
  T extends number ? number :
  T extends string ? string :
  T extends boolean ? boolean :
  never;

export type FilterCondition<T> = {
  eq: FilterValue<T>;
  neq: FilterValue<T>;
  gt: T extends number | Date ? FilterValue<T> : never;
  gte: T extends number | Date ? FilterValue<T> : never;
  lt: T extends number | Date ? FilterValue<T> : never;
  lte: T extends number | Date ? FilterValue<T> : never;
  in: FilterValue<T>[];
  notIn: FilterValue<T>[];
  between: [FilterValue<T>, FilterValue<T>] | [string, string];
  like: T extends string ? string : never;
  notLike: T extends string ? string : never;
  globalIn: FilterValue<T>[];
  globalNotIn: FilterValue<T>[];
  inSubquery: string;
  globalInSubquery: string;
  inTable: string;
  globalInTable: string;
  inTuple: [FilterValue<T>, FilterValue<T>][];
  globalInTuple: [FilterValue<T>, FilterValue<T>][];
};

// Define type-safe filter operators and their expected value types
export type FilterValueType<T, Op extends FilterOperator, Schema = any> =
  Op extends 'in' | 'notIn' | 'globalIn' | 'globalNotIn'
  ? T extends (infer U)[] ? U[] : T[]
  : Op extends 'between'
  ? [T, T] | [string, string]
  : Op extends 'inSubquery' | 'globalInSubquery'
  ? string
  : Op extends 'inTable' | 'globalInTable'
  ? keyof Schema
  : Op extends 'inTuple' | 'globalInTuple'
  ? [T, T][]
  : T;

// Type-safe operator mapping
export type OperatorValueMap<T, Schema = any> = {
  'eq': T | string;
  'neq': T | string;
  'gt': T extends string | number | Date ? T | string : never;
  'lt': T extends string | number | Date ? T | string : never;
  'gte': T extends string | number | Date ? T | string : never;
  'lte': T extends string | number | Date ? T | string : never;
  'in': (T | string)[];
  'notIn': (T | string)[];
  'between': [T | string, T | string] | [string, string];
  'like': T extends string ? string : never;
  'notLike': T extends string ? string : never;
  'globalIn': (T | string)[];
  'globalNotIn': (T | string)[];
  'inSubquery': string;
  'globalInSubquery': string;
  'inTable': keyof Schema;
  'globalInTable': keyof Schema;
  'inTuple': [T | string, T | string][];
  'globalInTuple': [T | string, T | string][];
};

export type FilterOperator = keyof OperatorValueMap<any>;

export interface FilterConditionInput<
  T = any,
  Schema = SchemaWithCrossDatabaseSupport,
  OriginalT = Record<string, any>
> {
  column: keyof OriginalT | TableColumn<Schema>;
  operator: FilterOperator;
  value: T;
  conjunction?: 'AND' | 'OR';
}
