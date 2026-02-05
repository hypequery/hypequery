import type { BuilderState, SchemaDefinition } from '../types/builder-state.js';
import { QueryBuilder } from '../query-builder.js';
import { FilterOperator } from '../../types/index.js';
import { PredicateExpression } from '../utils/predicate-builder.js';
export declare class FilteringFeature<Schema extends SchemaDefinition<Schema>, State extends BuilderState<Schema, string, any, keyof Schema, Partial<Record<string, keyof Schema>>>> {
    private builder;
    constructor(builder: QueryBuilder<Schema, State>);
    addCondition(conjunction: 'AND' | 'OR', column: string | string[], operator: FilterOperator, value: any): {
        where: import("../../types/base.js").WhereCondition[];
        parameters: any[];
        select?: (string | keyof State["output"])[] | undefined;
        groupBy?: string[];
        having?: string[];
        limit?: number;
        offset?: number;
        distinct?: boolean;
        orderBy?: {
            column: keyof State["output"] | import("../../types/schema.js").TableColumn<Schema>;
            direction: import("../../types/base.js").OrderDirection;
        }[] | undefined;
        joins?: import("../../types/base.js").JoinClause[];
        ctes?: string[];
        unionQueries?: string[];
        settings?: string;
    };
    addExpressionCondition(conjunction: 'AND' | 'OR', expression: PredicateExpression): {
        where: import("../../types/base.js").WhereCondition[];
        parameters: any[];
        select?: (string | keyof State["output"])[] | undefined;
        groupBy?: string[];
        having?: string[];
        limit?: number;
        offset?: number;
        distinct?: boolean;
        orderBy?: {
            column: keyof State["output"] | import("../../types/schema.js").TableColumn<Schema>;
            direction: import("../../types/base.js").OrderDirection;
        }[] | undefined;
        joins?: import("../../types/base.js").JoinClause[];
        ctes?: string[];
        unionQueries?: string[];
        settings?: string;
    };
    startWhereGroup(): {
        where: import("../../types/base.js").WhereCondition[];
        select?: (string | keyof State["output"])[] | undefined;
        groupBy?: string[];
        having?: string[];
        limit?: number;
        offset?: number;
        distinct?: boolean;
        orderBy?: {
            column: keyof State["output"] | import("../../types/schema.js").TableColumn<Schema>;
            direction: import("../../types/base.js").OrderDirection;
        }[] | undefined;
        joins?: import("../../types/base.js").JoinClause[];
        parameters?: any[];
        ctes?: string[];
        unionQueries?: string[];
        settings?: string;
    };
    startOrWhereGroup(): {
        where: import("../../types/base.js").WhereCondition[];
        select?: (string | keyof State["output"])[] | undefined;
        groupBy?: string[];
        having?: string[];
        limit?: number;
        offset?: number;
        distinct?: boolean;
        orderBy?: {
            column: keyof State["output"] | import("../../types/schema.js").TableColumn<Schema>;
            direction: import("../../types/base.js").OrderDirection;
        }[] | undefined;
        joins?: import("../../types/base.js").JoinClause[];
        parameters?: any[];
        ctes?: string[];
        unionQueries?: string[];
        settings?: string;
    };
    endWhereGroup(): {
        where: import("../../types/base.js").WhereCondition[];
        select?: (string | keyof State["output"])[] | undefined;
        groupBy?: string[];
        having?: string[];
        limit?: number;
        offset?: number;
        distinct?: boolean;
        orderBy?: {
            column: keyof State["output"] | import("../../types/schema.js").TableColumn<Schema>;
            direction: import("../../types/base.js").OrderDirection;
        }[] | undefined;
        joins?: import("../../types/base.js").JoinClause[];
        parameters?: any[];
        ctes?: string[];
        unionQueries?: string[];
        settings?: string;
    };
}
//# sourceMappingURL=filtering.d.ts.map