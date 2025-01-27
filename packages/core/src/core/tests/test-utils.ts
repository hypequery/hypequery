import { QueryBuilder } from '../query-builder';

type ColumnType = 'Int32' | 'String' | 'Float64' | 'Date';

export type TestTableSchema = {
  id: 'Int32';
  name: 'String';
  price: 'Float64';
  created_at: 'Date';
  category: 'String';
  active: 'Int32';
  created_by: 'Int32';
  updated_by: 'Int32';
};

export type UsersSchema = {
  id: 'Int32';
  user_name: 'String';
  email: 'String';
  created_at: 'Date';
};

// Full schema type with all tables
export interface TestSchema {
  test_table: TestTableSchema;
  users: UsersSchema;
  [tableName: string]: { [columnName: string]: ColumnType };  // Add index signature
}

// Test data
export const TEST_SCHEMAS: TestSchema = {
  test_table: {
    id: 'Int32',
    name: 'String',
    price: 'Float64',
    created_at: 'Date',
    category: 'String',
    active: 'Int32',
    created_by: 'Int32',
    updated_by: 'Int32'
  },
  users: {
    id: 'Int32',
    user_name: 'String',
    email: 'String',
    created_at: 'Date'
  }
};

export function setupTestBuilder(): QueryBuilder<TestSchema, TestSchema['test_table'], false, {}> {
  return new QueryBuilder<TestSchema, TestSchema['test_table'], false, {}>(
    'test_table',
    {
      name: 'test_table',
      columns: TEST_SCHEMAS.test_table
    },
    TEST_SCHEMAS
  );
}