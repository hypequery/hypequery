interface CacheKeyInput {
    namespace: string;
    sql: string;
    parameters: unknown[];
    settings?: Record<string, unknown> | undefined;
    version?: string;
    tableName?: string;
}
export declare function computeCacheKey({ namespace, sql, parameters, settings, version, tableName }: CacheKeyInput): string;
export {};
//# sourceMappingURL=key.d.ts.map