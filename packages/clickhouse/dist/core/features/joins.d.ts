import type { BuilderState, SchemaDefinition } from '../types/builder-state.js';
import { QueryBuilder } from '../query-builder.js';
import { JoinType } from '../../types/index.js';
export declare class JoinFeature<Schema extends SchemaDefinition<Schema>, State extends BuilderState<Schema, string, any, keyof Schema, Partial<Record<string, keyof Schema>>>> {
    private builder;
    constructor(builder: QueryBuilder<Schema, State>);
    addJoin<TableName extends keyof Schema>(type: JoinType, table: TableName, leftColumn: string, rightColumn: `${TableName & string}.${keyof Schema[TableName] & string}`, alias?: string): {
        joins: import("../../types/base.js").JoinClause[];
        select?: (string | keyof State["output"])[] | undefined;
        where?: import("../../types/base.js").WhereCondition[];
        groupBy?: string[];
        having?: string[];
        limit?: number;
        offset?: number;
        distinct?: boolean;
        orderBy?: {
            column: keyof State["output"] | import("../../types/schema.js").TableColumn<Schema>;
            direction: import("../../types/base.js").OrderDirection;
        }[] | undefined;
        parameters?: any[];
        ctes?: string[];
        unionQueries?: string[];
        settings?: string;
    };
}
//# sourceMappingURL=joins.d.ts.map