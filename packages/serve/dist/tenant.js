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
export function createTenantScope(db, options) {
    if (!options.tenantId) {
        return db;
    }
    const originalTable = db.table.bind(db);
    return {
        ...db,
        table: (name) => {
            const query = originalTable(name);
            // Auto-inject tenant filter
            if (query && typeof query.where === 'function') {
                return query.where(options.column, 'eq', options.tenantId);
            }
            return query;
        },
    };
}
/**
 * Runtime warning when tenant isolation might be misconfigured
 */
export function warnTenantMisconfiguration(options) {
    if (!options.hasTenantConfig) {
        console.warn(`[hypequery/serve] Query "${options.queryKey}" accesses user data but has no tenant configuration. ` +
            `This may lead to data leaks. Add tenant config to defineServe or the query definition.`);
    }
    else if (options.hasTenantId && options.mode === 'manual') {
        console.warn(`[hypequery/serve] Query "${options.queryKey}" uses manual tenant mode. ` +
            `Ensure you manually filter queries by tenantId to prevent data leaks.`);
    }
}
