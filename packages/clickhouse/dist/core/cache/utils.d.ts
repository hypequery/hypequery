import type { CacheConfig, CacheOptions } from './types.js';
import type { QueryRuntimeContext } from './runtime-context.js';
import { CacheController } from './controller.js';
export declare function mergeCacheOptionsPartial(target: CacheOptions | undefined, update: CacheOptions): CacheOptions;
export declare function initializeCacheRuntime(cacheConfig: CacheConfig | undefined, namespace: string): {
    runtime: QueryRuntimeContext;
    cacheController: CacheController;
};
//# sourceMappingURL=utils.d.ts.map