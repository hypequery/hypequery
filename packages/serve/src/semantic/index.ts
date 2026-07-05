export * from './datasets/index.js';

// Per-request semantic runtime helpers for middleware (warehouse routing,
// tenancy, cache partitioning).
export {
  attachSemanticRuntime,
  attachSemanticQueryBuilder,
  attachSemanticTenantRuntime,
  attachSemanticCacheScope,
  resolveSemanticExecutionRuntime,
  resolveSemanticCacheScope,
} from './query-builder-context.js';
export type { ServeSemanticRuntime } from './query-builder-context.js';
