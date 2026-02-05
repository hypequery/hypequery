import { SelectQB } from '../query-builder.js';
import type { TableRecord } from '../../types/schema.js';
export type TestTableSchema = {
    id: 'Int32';
    name: 'String';
    price: 'Float64';
    created_at: 'Date';
    category: 'String';
    active: 'UInt8';
    created_by: 'Int32';
    updated_by: 'Int32';
    status: 'String';
    brand: 'String';
    total: 'Int32';
    priority: 'String';
    is_premium: 'Bool';
    metadata: 'Map(String, String)';
    tags: 'Array(String)';
    settings: 'Map(LowCardinality(String), String)';
    optional_name: 'Nullable(String)';
    categories: 'Array(LowCardinality(String))';
    feature_flags: 'Array(Map(LowCardinality(String), String))';
    optional_tags: 'Nullable(Array(String))';
    permissions: 'Map(String, Array(String))';
    created_timestamp: 'DateTime64(9)';
};
export type UsersSchema = {
    id: 'Int32';
    user_name: 'String';
    email: 'String';
    created_at: 'Date';
    profile: 'Map(String, String)';
    preferences: 'Nullable(Map(LowCardinality(String), String))';
    roles: 'Array(LowCardinality(String))';
    is_active: 'Bool';
};
export interface TestSchema {
    test_table: TestTableSchema;
    users: UsersSchema;
}
export declare const TEST_SCHEMAS: TestSchema;
export declare function setupUsersBuilder(): SelectQB<TestSchema, 'users', TableRecord<TestSchema['users']>, 'users'>;
export declare function setupTestBuilder(): SelectQB<TestSchema, 'test_table', TableRecord<TestSchema['test_table']>, 'test_table'>;
//# sourceMappingURL=test-utils.d.ts.map