import type { CacheSerializationResult } from './types.js';
export declare function stableStringify(value: unknown): string;
export declare function defaultSerialize(value: unknown): CacheSerializationResult;
export declare function defaultDeserialize<T = unknown>(raw: string | Uint8Array): T;
export declare function estimateByteSize(value: unknown): number;
//# sourceMappingURL=serialization.d.ts.map