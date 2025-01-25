export type ColumnType =
    | 'String'
    | 'Int32'
    | 'Int64'
    | 'Float64'
    | 'DateTime'
    | 'Date'
    | 'Array(String)'
    | 'Array(Int32)';

export interface TableSchema<T> {
    name: string;
    columns: T;
}

export type DatabaseSchema = Record<string, Record<string, ColumnType>>;

export type SelectExpression<T> = keyof T | number | { [alias: string]: string };
export type WhereExpression = string;
export type GroupByExpression<T> = keyof T | Array<keyof T>;

export interface QueryConfig<T> {
    select?: Array<SelectExpression<T>>;
    where?: WhereExpression[];
    groupBy?: GroupByExpression<T>;
    limit?: number;
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

export type TransformedValue<T> = T extends 'String' ? string :
    T extends 'Date' ? Date :
    T extends 'Float64' ? number :
    T extends 'Int32' | 'Int64' ? number : never;

export type SelectedColumns<T, K extends keyof T> = {
    [P in K]: TransformedValue<T[P]>;
};
