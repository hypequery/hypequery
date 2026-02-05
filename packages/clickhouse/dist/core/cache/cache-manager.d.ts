import type { QueryBuilder, ExecuteOptions } from '../query-builder.js';
import type { AnyBuilderState, SchemaDefinition } from '../types/builder-state.js';
export declare function executeWithCache<Schema extends SchemaDefinition<Schema>, State extends AnyBuilderState>(builder: QueryBuilder<Schema, State>, options?: ExecuteOptions): Promise<State['output'][]>;
//# sourceMappingURL=cache-manager.d.ts.map