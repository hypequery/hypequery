import { QueryBuilder } from '../query-builder';


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
};

export type UsersSchema = {
  id: 'Int32';
  user_name: 'String';
  email: 'String';
  created_at: 'Date';
};

// Full schema type with all tables (strict, no index signature)
export interface TestSchema {
  test_table: TestTableSchema;
  users: UsersSchema;
}

// Test data
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
  },
  users: {
    id: 'Int32',
    user_name: 'String',
    email: 'String',
    created_at: 'Date'
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