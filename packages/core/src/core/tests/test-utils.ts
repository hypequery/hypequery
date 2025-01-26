import { QueryBuilder } from '../query-builder';

export type TestSchema = {
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

export const TEST_SCHEMAS = {
  test_table: {
    name: 'test_table',
    columns: {

      id: 'Int32',
      name: 'String',
      price: 'Float64',
      created_at: 'Date',
      category: 'String',
      active: 'Int32',
      created_by: 'Int32',
      updated_by: 'Int32'
    } satisfies TestSchema
  },
  users: {
    name: 'users',
    columns: {
      id: 'Int32',
      user_name: 'String',
      email: 'String',
      created_at: 'Date'
    } satisfies UsersSchema
  }
};

export function setupTestBuilder(): QueryBuilder<TestSchema> {
  return new QueryBuilder<TestSchema>(
    'test_table',
    TEST_SCHEMAS.test_table,
    { name: 'test_db', columns: TEST_SCHEMAS }
  );
} 