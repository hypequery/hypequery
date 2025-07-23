import { QueryBuilder } from '../query-builder.js';

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


export function setupUsersBuilder(): QueryBuilder<TestSchema, TestSchema['users'], false, {}, TestSchema['users']> {
  return new QueryBuilder<TestSchema, TestSchema['users'], false, {}, TestSchema['users']>(
    'users',
    {
      name: 'users',
      columns: TEST_SCHEMAS.users
    },
    TEST_SCHEMAS
  );
}

export function setupTestBuilder(): QueryBuilder<TestSchema, TestSchema['test_table'], false, {}, TestSchema['test_table']> {
  return new QueryBuilder<TestSchema, TestSchema['test_table'], false, {}, TestSchema['test_table']>(
    'test_table',
    {
      name: 'test_table',
      columns: TEST_SCHEMAS.test_table
    },
    TEST_SCHEMAS
  );
}