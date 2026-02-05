import type { QueryRuntimeContext } from './runtime-context.js';
import type { CacheStats } from './types.js';
export declare class CacheController {
    private context;
    constructor(context: QueryRuntimeContext);
    invalidateKey(key: string): Promise<void>;
    invalidateTags(tags: string[]): Promise<void>;
    clear(): Promise<void>;
    warm(queries: Array<() => Promise<unknown>>): Promise<void>;
    getStats(): CacheStats & {
        hitRate: number;
    };
    private removeParsedValuesByTags;
}
//# sourceMappingURL=controller.d.ts.map