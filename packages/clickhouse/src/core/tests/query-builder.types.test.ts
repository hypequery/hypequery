import { QueryBuilder } from '../query-builder.js';
import { setupTestBuilder, setupUsersBuilder, TestSchema } from './test-utils.js';
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

  it('should return correct types for users table with complex types', () => {
    const usersBuilder = setupUsersBuilder();
    const query = usersBuilder
      .select(['user_name', 'profile', 'preferences', 'roles', 'is_active']);

    type Result = Awaited<ReturnType<typeof query.execute>>;
    type Expected = {
      user_name: string;
      profile: Record<string, string>;
      preferences: Record<string, string> | null;
      roles: string[];
      is_active: boolean;
    }[];

    type Assert = Expect<Equal<Result, Expected>> extends true ? true : false;
  });

  it('should return correct types for mixed complex and simple columns', () => {
    const query = builder
      .select(['id', 'name', 'is_premium', 'metadata', 'tags', 'optional_name']);

    type Result = Awaited<ReturnType<typeof query.execute>>;
    type Expected = {
      id: number;
      name: string;
      is_premium: boolean;
      metadata: Record<string, string>;
      tags: string[];
      optional_name: string | null;
    }[];

    type Assert = Expect<Equal<Result, Expected>> extends true ? true : false;
  });

  it('should return correct types for complex nested types', () => {
    const query = builder
      .select(['feature_flags', 'permissions']);

    type Result = Awaited<ReturnType<typeof query.execute>>;
    type Expected = {
      feature_flags: Record<string, string>[];
      permissions: Record<string, string[]>;
    }[];

    type Assert = Expect<Equal<Result, Expected>> extends true ? true : false;
  });

  it('should return correct types for DateTime64 columns', () => {
    const query = builder
      .select(['created_timestamp', 'created_at']);

    type Result = Awaited<ReturnType<typeof query.execute>>;
    type Expected = {
      created_timestamp: Date;
      created_at: Date;
    }[];

    type Assert = Expect<Equal<Result, Expected>> extends true ? true : false;
  });

  it('should return correct types for Array columns', () => {
    const query = builder
      .select(['tags', 'categories']);

    type Result = Awaited<ReturnType<typeof query.execute>>;
    type Expected = {
      tags: string[];
      categories: string[];
    }[];

    type Assert = Expect<Equal<Result, Expected>> extends true ? true : false;
  });

  it('should return correct types for Nullable columns', () => {
    const query = builder
      .select(['optional_name', 'optional_tags']);

    type Result = Awaited<ReturnType<typeof query.execute>>;
    type Expected = {
      optional_name: string | null;
      optional_tags: string[] | null;
    }[];

    type Assert = Expect<Equal<Result, Expected>> extends true ? true : false;
  });
  it('should return correct types for Map columns', () => {
    const query = builder
      .select(['metadata', 'settings']);

    type Result = Awaited<ReturnType<typeof query.execute>>;
    type Expected = {
      metadata: Record<string, string>;
      settings: Record<string, string>;
    }[];

    type Assert = Expect<Equal<Result, Expected>> extends true ? true : false;
  });

  it('should preserve type safety across method chains with complex types', () => {
    const query = builder
      .select(['name', 'is_premium', 'metadata'])
      .where('is_premium', 'eq', true)
      .orderBy('name', 'ASC')
      .limit(10);

    type Result = Awaited<ReturnType<typeof query.execute>>;
    type Expected = {
      name: string;
      is_premium: boolean;
      metadata: Record<string, string>;
    }[];

    type Assert = Expect<Equal<Result, Expected>> extends true ? true : false;
  });
}); 
