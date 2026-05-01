import type { Equal, Expect } from '@type-challenges/utils';
import { rawAs } from '../src/core/utils/sql-expressions.js';
import { setupTestBuilder } from '../src/core/tests/test-utils.js';

const builder = setupTestBuilder();

const joinedAggregation = builder
  .innerJoin('users', 'created_by', 'users.id')
  .select(['users.user_name'])
  .count('users.id', 'user_count')
  .groupBy('users.user_name');

type JoinedAggregationResult = Awaited<ReturnType<typeof joinedAggregation.execute>>;
type JoinedAggregationExpected = {
  user_name: string;
  user_count: string;
}[];
type AssertJoinedAggregation = Expect<Equal<JoinedAggregationResult, JoinedAggregationExpected>>;

const explicitThenAggregate = builder
  .select(['name'])
  .groupBy('name')
  .sum('price', 'revenue');

type ExplicitThenAggregateResult = Awaited<ReturnType<typeof explicitThenAggregate.execute>>;
type ExplicitThenAggregateExpected = {
  name: string;
  revenue: string;
}[];
type AssertExplicitThenAggregate = Expect<Equal<ExplicitThenAggregateResult, ExplicitThenAggregateExpected>>;

const aliasedExpressionAggregation = builder
  .select([rawAs<string, 'day'>('toDate(created_at)', 'day')])
  .sum('price', 'revenue');

type AliasedExpressionAggregationResult = Awaited<ReturnType<typeof aliasedExpressionAggregation.execute>>;
type AliasedExpressionAggregationExpected = {
  day: string;
  revenue: string;
}[];
type AssertAliasedExpressionAggregation = Expect<
  Equal<AliasedExpressionAggregationResult, AliasedExpressionAggregationExpected>
>;

const repeatedGroupBy = builder
  .select(['name', 'category'])
  .groupBy('name')
  .groupBy('category');

type RepeatedGroupByResult = Awaited<ReturnType<typeof repeatedGroupBy.execute>>;
type RepeatedGroupByExpected = {
  name: string;
  category: string;
}[];
type AssertRepeatedGroupBy = Expect<Equal<RepeatedGroupByResult, RepeatedGroupByExpected>>;
