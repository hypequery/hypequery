import { QueryBuilder } from '../query-builder.js';
import { buildRuntimeContext, resolveCacheConfig } from '../cache/runtime-context.js';
export const TEST_SCHEMAS = {
    test_table: {
        id: 'Int32',
        name: 'String',
        price: 'Float64',
        created_at: 'Date',
        category: 'String',
        active: 'UInt8',
        created_by: 'Int32',
        updated_by: 'Int32',
        status: 'String',
        brand: 'String',
        total: 'Int32',
        priority: 'String',
        is_premium: 'Bool',
        metadata: 'Map(String, String)',
        tags: 'Array(String)',
        settings: 'Map(LowCardinality(String), String)',
        optional_name: 'Nullable(String)',
        categories: 'Array(LowCardinality(String))',
        feature_flags: 'Array(Map(LowCardinality(String), String))',
        optional_tags: 'Nullable(Array(String))',
        permissions: 'Map(String, Array(String))',
        created_timestamp: 'DateTime64(9)',
    },
    users: {
        id: 'Int32',
        user_name: 'String',
        email: 'String',
        created_at: 'Date',
        profile: 'Map(String, String)',
        preferences: 'Nullable(Map(LowCardinality(String), String))',
        roles: 'Array(LowCardinality(String))',
        is_active: 'Bool',
    }
};
function createTestRuntime() {
    return buildRuntimeContext(resolveCacheConfig(undefined, 'tests'));
}
export function setupUsersBuilder() {
    const state = {
        schema: TEST_SCHEMAS,
        tables: 'users',
        output: {},
        baseTable: 'users',
        base: TEST_SCHEMAS.users,
        aliases: {}
    };
    return new QueryBuilder('users', state, createTestRuntime());
}
export function setupTestBuilder() {
    const state = {
        schema: TEST_SCHEMAS,
        tables: 'test_table',
        output: {},
        baseTable: 'test_table',
        base: TEST_SCHEMAS.test_table,
        aliases: {}
    };
    return new QueryBuilder('test_table', state, createTestRuntime());
}
