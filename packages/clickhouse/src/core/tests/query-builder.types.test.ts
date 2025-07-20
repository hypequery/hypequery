import { QueryBuilder } from '../query-builder.js';
import { setupTestBuilder, TestSchema } from './test-utils.js';
import type { Equal, Expect } from '@type-challenges/utils';

describe('QueryBuilder - Type Safety', () => {
  let builder: QueryBuilder<TestSchema, TestSchema['test_table'], false, {}>;

  beforeEach(() => {
    builder = setupTestBuilder();
  });

  it('should return correct types for simple select', () => {
    const query = builder
      .select(['created_at', 'price']);

    type Result = Awaited<ReturnType<typeof query.execute>>;
    type Expected = { created_at: Date; price: number; }[];

    type Assert = Expect<Equal<Result, Expected>> extends true ? true : false;
  });

  it('should return correct types for aggregations', () => {
    const query = builder
      .sum('price', 'total_price')
      .count('price', 'total_count')

    type Result = Awaited<ReturnType<typeof query.execute>>;
    type Expected = {
      total_price: string;
      total_count: string;
    }[];

    type Assert = Expect<Equal<Result, Expected>> extends true ? true : false;
  });

  it('should return correct types for select with aggregations', () => {
    const query = builder
      .select(['category'])
      .sum('price');

    type Result = Awaited<ReturnType<typeof query.execute>>;
    type Expected = {
      category: string;
      price_sum: string;
    }[];

    type Assert = Expect<Equal<Result, Expected>> extends true ? true : false;
  });

  it('should error on invalid table names', () => {
    // @ts-expect-error - 'invalid_table' doesn't exist in schema
    builder.innerJoin('invalid_table', 'id', 'invalid_table.id');

    // @ts-expect-error - 'users222' doesn't exist in schema
    builder.innerJoin('users222', 'created_by', 'users222.id');

    // This should type check
    builder.innerJoin('users', 'created_by', 'users.id');
  });

  it('should error on invalid column names in join conditions', () => {
    // @ts-expect-error - 'invalid_column' doesn't exist in users table
    builder.innerJoin('users', 'created_by', 'users.invalid_column');

    // @ts-expect-error - 'fake_id' doesn't exist in current table
    builder.innerJoin('users', 'fake_id', 'users.id');

    // This should type check
    builder.innerJoin('users', 'created_by', 'users.id');
  });
}); 