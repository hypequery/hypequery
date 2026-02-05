import type { BuilderState, SchemaDefinition } from '../types/builder-state.js';
import { QueryBuilder } from '../query-builder.js';
import { type QueryLog } from '../utils/logger.js';
interface ExecutorRunOptions {
    queryId?: string;
    logContext?: Partial<QueryLog>;
}
export declare class ExecutorFeature<Schema extends SchemaDefinition<Schema>, State extends BuilderState<Schema, string, any, keyof Schema, Partial<Record<string, keyof Schema>>>> {
    private builder;
    constructor(builder: QueryBuilder<Schema, State>);
    toSQLWithParams(): {
        sql: string;
        parameters: any[];
    };
    toSQL(): string;
    execute(options?: ExecutorRunOptions): Promise<State['output'][]>;
    stream(): Promise<ReadableStream<State['output'][]>>;
    private toSQLWithoutParameters;
}
export {};
//# sourceMappingURL=executor.d.ts.map