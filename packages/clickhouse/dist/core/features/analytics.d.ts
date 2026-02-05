import { ClickHouseSettings } from '@clickhouse/client-common';
import type { AnyBuilderState, BuilderState, SchemaDefinition } from '../types/builder-state.js';
import { QueryBuilder } from '../query-builder.js';
export declare class AnalyticsFeature<Schema extends SchemaDefinition<Schema>, State extends BuilderState<Schema, string, any, keyof Schema, Partial<Record<string, keyof Schema>>>> {
    private builder;
    constructor(builder: QueryBuilder<Schema, State>);
    addCTE(alias: string, subquery: QueryBuilder<any, AnyBuilderState> | string): {
        ctes: string[];
        select?: (string | keyof State["output"])[] | undefined;
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
        unionQueries?: string[];
        settings?: string;
    };
    addTimeInterval(column: string, interval: string, method: 'toStartOfInterval' | 'toStartOfMinute' | 'toStartOfHour' | 'toStartOfDay' | 'toStartOfWeek' | 'toStartOfMonth' | 'toStartOfQuarter' | 'toStartOfYear'): {
        groupBy: string[];
        select?: (string | keyof State["output"])[] | undefined;
        where?: import("../../types/base.js").WhereCondition[];
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
    addSettings(opts: ClickHouseSettings): {
        settings: string;
        select?: (string | keyof State["output"])[] | undefined;
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
    };
}
//# sourceMappingURL=analytics.d.ts.map