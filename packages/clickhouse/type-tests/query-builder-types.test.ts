import { QueryBuilder } from '../src/core/query-builder.js';
import { setupTestBuilder, setupUsersBuilder, TestSchema } from '../src/core/tests/test-utils.js';
import { createPredicateBuilder } from '../src/core/utils/predicate-builder.js';
import type { Equal, Expect } from '@type-challenges/utils';

const builder: QueryBuilder<TestSchema, TestSchema['test_table'], false, {}> = setupTestBuilder();

const simpleSelect = builder.select(['created_at', 'price']);
type SimpleResult = Awaited<ReturnType<typeof simpleSelect.execute>>;
type SimpleExpected = { created_at: Date; price: number }[];
type AssertSimpleSelect = Expect<Equal<SimpleResult, SimpleExpected>>;

const aggregationQuery = builder.sum('price', 'total_price').count('price', 'total_count');
type AggResult = Awaited<ReturnType<typeof aggregationQuery.execute>>;
type AggExpected = { total_price: string; total_count: string }[];
type AssertAggregations = Expect<Equal<AggResult, AggExpected>>;

const selectWithAgg = builder.select(['category']).sum('price');
type SelectAggResult = Awaited<ReturnType<typeof selectWithAgg.execute>>;
type SelectAggExpected = { category: string; price_sum: string }[];
type AssertSelectAggregations = Expect<Equal<SelectAggResult, SelectAggExpected>>;

// @ts-expect-error - table does not exist
builder.innerJoin('invalid_table', 'id', 'invalid_table.id');
// @ts-expect-error - table does not exist
builder.innerJoin('users222', 'created_by', 'users222.id');

builder.innerJoin('users', 'created_by', 'users.id');

// @ts-expect-error - invalid column name on join target
builder.innerJoin('users', 'created_by', 'users.invalid_column');
// @ts-expect-error - invalid column name on source
builder.innerJoin('users', 'fake_id', 'users.id');

builder.innerJoin('users', 'created_by', 'users.id');

const usersBuilder = setupUsersBuilder();
const usersQuery = usersBuilder.select(['user_name', 'profile', 'preferences', 'roles', 'is_active']);
type UsersResult = Awaited<ReturnType<typeof usersQuery.execute>>;
type UsersExpected = {
  user_name: string;
  profile: Record<string, string>;
  preferences: Record<string, string> | null;
  roles: string[];
  is_active: boolean;
}[];
type AssertUsersSelect = Expect<Equal<UsersResult, UsersExpected>>;

const mixedQuery = builder.select(['id', 'name', 'is_premium', 'metadata', 'tags', 'optional_name']);
type MixedResult = Awaited<ReturnType<typeof mixedQuery.execute>>;
type MixedExpected = {
  id: number;
  name: string;
  is_premium: boolean;
  metadata: Record<string, string>;
  tags: string[];
  optional_name: string | null;
}[];
type AssertMixedSelect = Expect<Equal<MixedResult, MixedExpected>>;

const nestedQuery = builder.select(['feature_flags', 'permissions']);
type NestedResult = Awaited<ReturnType<typeof nestedQuery.execute>>;
type NestedExpected = {
  feature_flags: Record<string, string>[];
  permissions: Record<string, string[]>;
}[];
type AssertNestedSelect = Expect<Equal<NestedResult, NestedExpected>>;

const dateQuery = builder.select(['created_timestamp', 'created_at']);
type DateResult = Awaited<ReturnType<typeof dateQuery.execute>>;
type DateExpected = { created_timestamp: Date; created_at: Date }[];
type AssertDateSelect = Expect<Equal<DateResult, DateExpected>>;

const arrayQuery = builder.select(['tags', 'categories']);
type ArrayResult = Awaited<ReturnType<typeof arrayQuery.execute>>;
type ArrayExpected = { tags: string[]; categories: string[] }[];
type AssertArraySelect = Expect<Equal<ArrayResult, ArrayExpected>>;

const nullableQuery = builder.select(['optional_name', 'optional_tags']);
type NullableResult = Awaited<ReturnType<typeof nullableQuery.execute>>;
type NullableExpected = { optional_name: string | null; optional_tags: string[] | null }[];
type AssertNullableSelect = Expect<Equal<NullableResult, NullableExpected>>;

const mapQuery = builder.select(['metadata', 'settings']);
type MapResult = Awaited<ReturnType<typeof mapQuery.execute>>;
type MapExpected = { metadata: Record<string, string>; settings: Record<string, string> }[];
type AssertMapSelect = Expect<Equal<MapResult, MapExpected>>;

const chainQuery = builder
  .select(['name', 'is_premium', 'metadata'])
  .where('is_premium', 'eq', true)
  .orderBy('name', 'ASC')
  .limit(10);
type ChainResult = Awaited<ReturnType<typeof chainQuery.execute>>;
type ChainExpected = { name: string; is_premium: boolean; metadata: Record<string, string> }[];
type AssertChainSelect = Expect<Equal<ChainResult, ChainExpected>>;

const predicateBuilder = createPredicateBuilder<TestSchema, TestSchema['test_table']>();
predicateBuilder.fn('hasAny', 'tags', ['foo']);
// @ts-expect-error - invalid column should be rejected
predicateBuilder.fn('hasAny', 'unknown_column', ['foo']);

builder.orWhere(expr => expr.fn('hasAny', 'tags', ['foo']));
