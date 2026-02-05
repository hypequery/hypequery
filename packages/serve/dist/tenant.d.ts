/**
 * Utilities for multi-tenant query isolation
 */
/**
 * Creates a tenant-scoped query builder wrapper that automatically
 * adds WHERE clauses to filter by tenant.
 *
 * @example
 * ```typescript
 * const api = defineServe({
 *   context: ({ auth }) => ({
 *     db: createTenantScope(myDb, {
 *       tenantId: auth?.tenantId,
 *       column: 'organization_id',
 *     }),
 *   }),
 * });
 * ```
 */
export declare function createTenantScope<TDb extends {
    table: (name: string) => any;
}>(db: TDb, options: {
    tenantId: string | null | undefined;
    column: string;
}): TDb;
/**
 * Runtime warning when tenant isolation might be misconfigured
 */
export declare function warnTenantMisconfiguration(options: {
    queryKey: string;
    hasTenantConfig: boolean;
    hasTenantId: boolean;
    mode?: string;
}): void;
//# sourceMappingURL=tenant.d.ts.map