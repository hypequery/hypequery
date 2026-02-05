import { FilterOperator } from "./filters.js";
import type { TableColumn } from './schema.js';
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
export type { ColumnType, TableSchema, DatabaseSchema, TableRecord, InferColumnType, TableColumn } from './schema.js';
export type WhereExpression = string;
export type GroupByExpression<T> = keyof T | Array<keyof T>;
export type OrderDirection = 'ASC' | 'DESC';
export interface StandardWhereCondition {
    column: string;
    operator: FilterOperator;
    value: any;
    conjunction: 'AND' | 'OR';
    type?: 'condition' | 'group-start' | 'group-end';
}
export interface ExpressionWhereCondition {
    type: 'expression';
    expression: string;
    parameters: any[];
    conjunction: 'AND' | 'OR';
}
export type WhereCondition = StandardWhereCondition | ExpressionWhereCondition;
export type JoinType = 'INNER' | 'LEFT' | 'RIGHT' | 'FULL';
export interface JoinClause {
    type: JoinType;
    table: string;
    leftColumn: string;
    rightColumn: string;
    alias?: string;
}
export type AggregationType<T, Aggregations, Column, A extends string, Suffix extends string, HasSelect extends boolean> = HasSelect extends true ? {
    [K in keyof T | A]: K extends keyof T ? T[K] : string;
} : Aggregations extends Record<string, string> ? Aggregations & Record<A extends undefined ? `${Column & string}_${Suffix}` : A, string> : Record<A extends undefined ? `${Column & string}_${Suffix}` : A, string>;
//# sourceMappingURL=base.d.ts.map