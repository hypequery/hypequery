import type { BuilderState, SchemaDefinition } from '../types/builder-state.js';
import { QueryBuilder } from '../query-builder.js';
import { OrderDirection } from '../../types/index.js';
export declare class QueryModifiersFeature<Schema extends SchemaDefinition<Schema>, State extends BuilderState<Schema, string, any, keyof Schema, Partial<Record<string, keyof Schema>>>> {
    private builder;
    constructor(builder: QueryBuilder<Schema, State>);
    addGroupBy(columns: string | string[]): {
        groupBy: string[];
        select?: (string | keyof State["output"])[] | undefined;
        where?: import("../../types/base.js").WhereCondition[];
        having?: string[];
        limit?: number;
        offset?: number;
        distinct?: boolean;
        orderBy?: {
            column: keyof State["output"] | import("../../types/schema.js").TableColumn<Schema>;
            direction: OrderDirection;
        }[] | undefined;
        joins?: import("../../types/base.js").JoinClause[];
        parameters?: any[];
        ctes?: string[];
        unionQueries?: string[];
        settings?: string;
    };
    addLimit(count: number): {
        limit: number;
        select?: (string | keyof State["output"])[] | undefined;
        where?: import("../../types/base.js").WhereCondition[];
        groupBy?: string[];
        having?: string[];
        offset?: number;
        distinct?: boolean;
        orderBy?: {
            column: keyof State["output"] | import("../../types/schema.js").TableColumn<Schema>;
            direction: OrderDirection;
        }[] | undefined;
        joins?: import("../../types/base.js").JoinClause[];
        parameters?: any[];
        ctes?: string[];
        unionQueries?: string[];
        settings?: string;
    };
    addOffset(count: number): {
        offset: number;
        select?: (string | keyof State["output"])[] | undefined;
        where?: import("../../types/base.js").WhereCondition[];
        groupBy?: string[];
        having?: string[];
        limit?: number;
        distinct?: boolean;
        orderBy?: {
            column: keyof State["output"] | import("../../types/schema.js").TableColumn<Schema>;
            direction: OrderDirection;
        }[] | undefined;
        joins?: import("../../types/base.js").JoinClause[];
        parameters?: any[];
        ctes?: string[];
        unionQueries?: string[];
        settings?: string;
    };
    addOrderBy(column: string, direction?: OrderDirection): {
        orderBy: {
            column: keyof State["output"] | import("../../types/schema.js").TableColumn<Schema>;
            direction: OrderDirection;
        }[];
        select?: (string | keyof State["output"])[] | undefined;
        where?: import("../../types/base.js").WhereCondition[];
        groupBy?: string[];
        having?: string[];
        limit?: number;
        offset?: number;
        distinct?: boolean;
        joins?: import("../../types/base.js").JoinClause[];
        parameters?: any[];
        ctes?: string[];
        unionQueries?: string[];
        settings?: string;
    };
    addHaving(condition: string, parameters?: any[]): {
        having: string[];
        parameters: any[] | undefined;
        select?: (string | keyof State["output"])[] | undefined;
        where?: import("../../types/base.js").WhereCondition[];
        groupBy?: string[];
        limit?: number;
        offset?: number;
        distinct?: boolean;
        orderBy?: {
            column: keyof State["output"] | import("../../types/schema.js").TableColumn<Schema>;
            direction: OrderDirection;
        }[] | undefined;
        joins?: import("../../types/base.js").JoinClause[];
        ctes?: string[];
        unionQueries?: string[];
        settings?: string;
    };
    setDistinct(): {
        distinct: boolean;
        select?: (string | keyof State["output"])[] | undefined;
        where?: import("../../types/base.js").WhereCondition[];
        groupBy?: string[];
        having?: string[];
        limit?: number;
        offset?: number;
        orderBy?: {
            column: keyof State["output"] | import("../../types/schema.js").TableColumn<Schema>;
            direction: OrderDirection;
        }[] | undefined;
        joins?: import("../../types/base.js").JoinClause[];
        parameters?: any[];
        ctes?: string[];
        unionQueries?: string[];
        settings?: string;
    };
}
//# sourceMappingURL=query-modifiers.d.ts.map