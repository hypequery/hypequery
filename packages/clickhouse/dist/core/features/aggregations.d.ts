import type { BuilderState, SchemaDefinition } from '../types/builder-state.js';
import { QueryBuilder } from '../query-builder.js';
export declare class AggregationFeature<Schema extends SchemaDefinition<Schema>, State extends BuilderState<Schema, string, any, keyof Schema, Partial<Record<string, keyof Schema>>>> {
    private builder;
    constructor(builder: QueryBuilder<Schema, State>);
    private createAggregation;
    sum(column: string, alias: string): {
        select: string[];
        where?: import("../../types/base.js").WhereCondition[];
        groupBy?: string[];
        having?: string[];
        limit?: number;
        offset?: number;
        distinct?: boolean;
        orderBy?: {
            column: keyof State["output"] | import("../../index.js").TableColumn<Schema>;
            direction: import("../../index.js").OrderDirection;
        }[] | undefined;
        joins?: import("../../types/base.js").JoinClause[];
        parameters?: any[];
        ctes?: string[];
        unionQueries?: string[];
        settings?: string;
    };
    count(column: string, alias: string): {
        select: string[];
        where?: import("../../types/base.js").WhereCondition[];
        groupBy?: string[];
        having?: string[];
        limit?: number;
        offset?: number;
        distinct?: boolean;
        orderBy?: {
            column: keyof State["output"] | import("../../index.js").TableColumn<Schema>;
            direction: import("../../index.js").OrderDirection;
        }[] | undefined;
        joins?: import("../../types/base.js").JoinClause[];
        parameters?: any[];
        ctes?: string[];
        unionQueries?: string[];
        settings?: string;
    };
    avg(column: string, alias: string): {
        select: string[];
        where?: import("../../types/base.js").WhereCondition[];
        groupBy?: string[];
        having?: string[];
        limit?: number;
        offset?: number;
        distinct?: boolean;
        orderBy?: {
            column: keyof State["output"] | import("../../index.js").TableColumn<Schema>;
            direction: import("../../index.js").OrderDirection;
        }[] | undefined;
        joins?: import("../../types/base.js").JoinClause[];
        parameters?: any[];
        ctes?: string[];
        unionQueries?: string[];
        settings?: string;
    };
    min(column: string, alias: string): {
        select: string[];
        where?: import("../../types/base.js").WhereCondition[];
        groupBy?: string[];
        having?: string[];
        limit?: number;
        offset?: number;
        distinct?: boolean;
        orderBy?: {
            column: keyof State["output"] | import("../../index.js").TableColumn<Schema>;
            direction: import("../../index.js").OrderDirection;
        }[] | undefined;
        joins?: import("../../types/base.js").JoinClause[];
        parameters?: any[];
        ctes?: string[];
        unionQueries?: string[];
        settings?: string;
    };
    max(column: string, alias: string): {
        select: string[];
        where?: import("../../types/base.js").WhereCondition[];
        groupBy?: string[];
        having?: string[];
        limit?: number;
        offset?: number;
        distinct?: boolean;
        orderBy?: {
            column: keyof State["output"] | import("../../index.js").TableColumn<Schema>;
            direction: import("../../index.js").OrderDirection;
        }[] | undefined;
        joins?: import("../../types/base.js").JoinClause[];
        parameters?: any[];
        ctes?: string[];
        unionQueries?: string[];
        settings?: string;
    };
}
//# sourceMappingURL=aggregations.d.ts.map