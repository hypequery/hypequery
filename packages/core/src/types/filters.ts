
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
  between: [FilterValue<T>, FilterValue<T>];
  like: T extends string ? string : never;
  notLike: T extends string ? string : never;
};

// Define type-safe filter operators and their expected value types
export type FilterValueType<T, Op extends FilterOperator> =
  Op extends 'in' | 'notIn'
  ? T extends (infer U)[] ? U[] : T[]
  : Op extends 'between'
  ? [T, T]
  : T;

// Type-safe operator mapping
export type OperatorValueMap<T> = {
  'eq': T;
  'neq': T;
  'gt': T extends string | number | Date ? T : never;
  'lt': T extends string | number | Date ? T : never;
  'gte': T extends string | number | Date ? T : never;
  'lte': T extends string | number | Date ? T : never;
  'in': T[];
  'notIn': T[];
  'between': [T, T];
  'like': T extends string ? string : never;
  'notLike': T extends string ? string : never;
};

export type FilterOperator = keyof OperatorValueMap<any>;