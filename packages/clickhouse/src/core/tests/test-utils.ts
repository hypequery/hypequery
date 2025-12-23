import { QueryBuilder, SelectQB } from '../query-builder.js';
import type { BuilderState } from '../types/builder-state.js';
import type { TableRecord } from '../../types/schema.js';
import { buildRuntimeContext, resolveCacheConfig } from '../cache/runtime-context.js';

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
  // New complex types for testing
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
  // Add complex types to users table too
  profile: 'Map(String, String)';
  preferences: 'Nullable(Map(LowCardinality(String), String))';
  roles: 'Array(LowCardinality(String))';
  is_active: 'Bool';
};

export interface TestSchema {
  test_table: TestTableSchema;
  users: UsersSchema;
}

export const TEST_SCHEMAS: TestSchema = {
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

type UsersState = BuilderState<
  TestSchema,
  'users',
  TableRecord<TestSchema['users']>,
  'users'
>;

type TestTableState = BuilderState<
  TestSchema,
  'test_table',
  TableRecord<TestSchema['test_table']>,
  'test_table'
>;

export function setupUsersBuilder(): SelectQB<TestSchema, 'users', TableRecord<TestSchema['users']>, 'users'> {
  const state: UsersState = {
    schema: TEST_SCHEMAS,
    tables: 'users',
    output: {} as TableRecord<TestSchema['users']>,
    baseTable: 'users',
    base: TEST_SCHEMAS.users,
    aliases: {}
  };
  return new QueryBuilder<TestSchema, UsersState>('users', state, createTestRuntime());
}

export function setupTestBuilder(): SelectQB<TestSchema, 'test_table', TableRecord<TestSchema['test_table']>, 'test_table'> {
  const state: TestTableState = {
    schema: TEST_SCHEMAS,
    tables: 'test_table',
    output: {} as TableRecord<TestSchema['test_table']>,
    baseTable: 'test_table',
    base: TEST_SCHEMAS.test_table,
    aliases: {}
  };
  return new QueryBuilder<TestSchema, TestTableState>('test_table', state, createTestRuntime());
}
