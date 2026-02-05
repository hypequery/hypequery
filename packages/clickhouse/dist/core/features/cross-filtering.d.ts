import type { BuilderState, SchemaDefinition } from '../types/builder-state.js';
import { QueryBuilder } from '../query-builder.js';
import { CrossFilter } from '../cross-filter.js';
export declare class CrossFilteringFeature<Schema extends SchemaDefinition<Schema>, State extends BuilderState<Schema, string, any, keyof Schema, Partial<Record<string, keyof Schema>>>> {
    private builder;
    constructor(builder: QueryBuilder<Schema, State>);
    applyCrossFilters(crossFilter: CrossFilter<Schema, Extract<keyof Schema, string>>): import("../../types/base.js").QueryConfig<State["output"], Schema>;
    private applyAndConditions;
    private applyOrConditions;
}
//# sourceMappingURL=cross-filtering.d.ts.map