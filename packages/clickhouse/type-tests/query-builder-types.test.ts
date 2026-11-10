import { createQueryBuilder, QueryBuilder } from '../src/core/query-builder.js';
import { CrossFilter } from '../src/core/cross-filter.js';
import { JoinRelationships } from '../src/core/join-relationships.js';
import { setupTestBuilder, setupUsersBuilder, TestSchema, TEST_SCHEMAS } from '../src/core/tests/test-utils.js';
import { createPredicateBuilder } from '../src/core/utils/predicate-builder.js';
import { rawAs } from '../src/core/utils/sql-expressions.js';
import type { Equal, Expect } from '@type-challenges/utils';

const builder = setupTestBuilder();
const builderUsers = setupUsersBuilder();
type BuilderStateType = typeof builder extends QueryBuilder<any, infer S> ? S : never;

const db = createQueryBuilder<TestSchema>({
  adapter: builder.getAdapter(),
  dialect: builder.getDialect(),
});

const totalsSubquery = builder
  .select(['id', 'created_by'])
  .sum('price', 'sum_value')
  .groupBy(['id', 'created_by']);
const queryFromSubquery = db.from(totalsSubquery)
  .select([
    'id',
    'sum_value',
    rawAs<string, 'negative_sum_value'>(
      'sumIf(sum_value, sum_value < 0)',
      'negative_sum_value',
    ),
  ]);
type FromSubqueryResult = Awaited<ReturnType<typeof queryFromSubquery.execute>>;
type FromSubqueryExpected = {
  id: number;
  sum_value: number;
  negative_sum_value: string;
}[];
type AssertFromSubquery = Expect<Equal<FromSubqueryResult, FromSubqueryExpected>>;

const allFromSubquery = db.from(totalsSubquery).select('*');
type AllFromSubqueryResult = Awaited<ReturnType<typeof allFromSubquery.execute>>;
type AllFromSubqueryExpected = {
  id: number;
  created_by: number;
  sum_value: number;
}[];
type AssertAllFromSubquery = Expect<Equal<AllFromSubqueryResult, AllFromSubqueryExpected>>;

const reaggregatedSubquery = db.from(totalsSubquery)
  .select(['id'])
  .sum('sum_value', 'combined_sum')
  .groupBy('id');
type ReaggregatedSubqueryResult = Awaited<ReturnType<typeof reaggregatedSubquery.execute>>;
// Only the TypeScript type survives the subquery, so the sum may be either form.
type ReaggregatedSubqueryExpected = { id: number; combined_sum: number | string }[];
type AssertReaggregatedSubquery = Expect<
  Equal<ReaggregatedSubqueryResult, ReaggregatedSubqueryExpected>
>;

const joinedFromSubquery = db.from(totalsSubquery)
  .innerJoin('users', 'created_by', 'users.id')
  .select(['id', 'sum_value', 'users.email']);
type JoinedFromSubqueryResult = Awaited<ReturnType<typeof joinedFromSubquery.execute>>;
type JoinedFromSubqueryExpected = { id: number; sum_value: number; email: string }[];
type AssertJoinedFromSubquery = Expect<
  Equal<JoinedFromSubqueryResult, JoinedFromSubqueryExpected>
>;

db.from(totalsSubquery).where('sum_value', 'lt', '0').groupBy('id');
// @ts-expect-error - unselected source-table columns are not visible outside the subquery
db.from(totalsSubquery).select(['name']);
// @ts-expect-error - unselected source-table columns cannot be filtered outside the subquery
db.from(totalsSubquery).where('category', 'eq', 'premium');
// @ts-expect-error - the original table qualifier is not in scope for an unaliased derived source
db.from(totalsSubquery).select(['test_table.id']);
// @ts-expect-error - aggregate aliases not produced by the inner query are not visible
db.from(totalsSubquery).select(['missing_sum']);
const derivedSource = db.from(totalsSubquery);
// @ts-expect-error - PREWHERE is only valid for table sources
derivedSource.prewhere('id', 'eq', 1);
// @ts-expect-error - PREWHERE is only valid for table sources
derivedSource.orPrewhere('id', 'eq', 1);
// @ts-expect-error - PREWHERE null helpers are only valid for table sources
derivedSource.prewhereNull('sum_value');
// @ts-expect-error - PREWHERE null helpers are only valid for table sources
derivedSource.prewhereNotNull('sum_value');

builder.prewhere('id', 'eq', 1);
builder.orPrewhere('id', 'eq', 1);
builder.prewhereNull('optional_name');
builder.prewhereNotNull('optional_name');

const crossFilter = new CrossFilter();
builder.applyCrossFilters(crossFilter);

const typedCrossFilter = new CrossFilter<TestSchema, 'test_table'>();
builder.applyCrossFilters(typedCrossFilter);

const inferredCrossFilter = new CrossFilter(TEST_SCHEMAS, 'test_table');
builder.applyCrossFilters(inferredCrossFilter);

const simpleSelect = builder.select(['created_at', 'price']);
type SimpleResult = Awaited<ReturnType<typeof simpleSelect.execute>>;
type SimpleExpected = { created_at: string; price: number }[];
type AssertSimpleSelect = Expect<Equal<SimpleResult, SimpleExpected>>;

const aggregationQuery = builder.sum('price', 'total_price').count('price', 'total_count');
type AggResult = Awaited<ReturnType<typeof aggregationQuery.execute>>;
// sum(Float64) is a JSON number; count() is a quoted UInt64.
type AggExpected = { total_price: number; total_count: string }[];
type AssertAggregations = Expect<Equal<AggResult, AggExpected>>;

const selectWithAgg = builder.select(['category']).sum('price');
type SelectAggResult = Awaited<ReturnType<typeof selectWithAgg.execute>>;
type SelectAggExpected = { category: string; price_sum: number }[];
type AssertSelectAggregations = Expect<Equal<SelectAggResult, SelectAggExpected>>;

type JoinTables = Parameters<typeof builder.innerJoin>[0];
type AssertJoinTables = Expect<Equal<JoinTables, keyof TestSchema>>;
// @ts-expect-error - table does not exist
const invalidJoinTable: JoinTables = 'invalid_table';
// @ts-expect-error - table does not exist
const invalidJoinTableAlias: JoinTables = 'users222';

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
type DateExpected = { created_timestamp: string; created_at: string }[];
type AssertDateSelect = Expect<Equal<DateResult, DateExpected>>;

const arrayQuery = builder.select(['tags', 'categories']);
type ArrayResult = Awaited<ReturnType<typeof arrayQuery.execute>>;
type ArrayExpected = { tags: string[]; categories: string[] }[];
type AssertArraySelect = Expect<Equal<ArrayResult, ArrayExpected>>;

builder.arrayJoin('tags');
builder.leftArrayJoin('categories');
builder.arrayJoin('optional_tags');
// @ts-expect-error - arrayJoin only accepts array-typed columns
builder.arrayJoin('total_amount');
// @ts-expect-error - leftArrayJoin only accepts array-typed columns
builder.leftArrayJoin('metadata');
builder
  .innerJoin('users', 'created_by', 'users.id')
  .arrayJoin('users.roles');
builder
  .innerJoin('users', 'created_by', 'users.id', 'creator')
  .leftArrayJoin('creator.roles');
builder
  .innerJoin('users', 'created_by', 'users.id')
  // @ts-expect-error - joined qualified column must still be array-typed
  .arrayJoin('users.email');
builder
  .innerJoin('users', 'created_by', 'users.id', 'creator')
  // @ts-expect-error - aliased joined column must still be array-typed
  .leftArrayJoin('creator.email');
builder.limitBy(3, 'category');
builder.limitBy(5, ['category', 'brand']);
builder.groupBy('category').withTotals();

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

const predicateBuilder = createPredicateBuilder<BuilderStateType>();
predicateBuilder.fn('hasAny', 'tags', ['foo']);
predicateBuilder.ch.dictGet('users_dict', 'name', predicateBuilder.col('created_by'));
// @ts-expect-error - helper name typo should be rejected
predicateBuilder.ch.getdict('users_dict', 'name', predicateBuilder.col('created_by'));
// @ts-expect-error - invalid column should be rejected
predicateBuilder.fn('hasAny', 'unknown_column', ['foo']);

builder.orWhere(expr => expr.fn('hasAny', 'tags', ['foo']));

const aliasSelection = builder.select([
  rawAs<number, 'avg_total'>('AVG(total_amount)', 'avg_total')
] as const);
type AliasSelectionResult = Awaited<ReturnType<typeof aliasSelection.execute>>;
type ExpectedAliasSelectionResult = { avg_total: number }[];
type AssertAliasSelection = Expect<Equal<AliasSelectionResult, ExpectedAliasSelectionResult>>;
type AliasRow = AliasSelectionResult[number];
type AliasRowKeys = keyof AliasRow;
type AssertAliasRowKeys = Expect<Equal<AliasRowKeys, 'avg_total'>>;
type AliasValue = AliasRow['avg_total'];
type AssertAliasValue = Expect<Equal<AliasValue, number>>;

const mixedAliasSelection = builder.select([
  'id',
  rawAs('COUNT(*)', 'value_count'),
]);
type MixedAliasSelectionResult = Awaited<ReturnType<typeof mixedAliasSelection.execute>>;
type ExpectedMixedAliasSelectionResult = { id: number; value_count: unknown }[];
type AssertMixedAliasSelection = Expect<Equal<MixedAliasSelectionResult, ExpectedMixedAliasSelectionResult>>;

const typedMixedAliasSelection = builder.select([
  'id',
  rawAs<number, 'value_count'>('COUNT(*)', 'value_count'),
]);
type TypedMixedAliasSelectionResult = Awaited<ReturnType<typeof typedMixedAliasSelection.execute>>;
type ExpectedTypedMixedAliasSelectionResult = { id: number; value_count: number }[];
type AssertTypedMixedAliasSelection = Expect<Equal<TypedMixedAliasSelectionResult, ExpectedTypedMixedAliasSelectionResult>>;

const joinedColumnsQuery = builder
  .innerJoin('users', 'created_by', 'users.id')
  .select(['users.email', 'name']);
type JoinedColumnsResult = Awaited<ReturnType<typeof joinedColumnsQuery.execute>>;
type JoinedColumnsExpected = { email: string; name: string }[];
type AssertJoinedColumns = Expect<Equal<JoinedColumnsResult, JoinedColumnsExpected>>;

const aliasWhereQuery = aliasSelection.where('avg_total', 'gt', 10);
type AliasWhereResult = Awaited<ReturnType<typeof aliasWhereQuery.execute>>;
type AssertAliasWhere = Expect<Equal<AliasWhereResult, { avg_total: number }[]>>;

const nestedJoinState = builder
  .innerJoin('users', 'created_by', 'users.id')
  .innerJoin('users', 'updated_by', 'users.id')
  .select(['users.user_name']);
type NestedJoinResult = Awaited<ReturnType<typeof nestedJoinState.execute>>;
type NestedJoinExpected = { user_name: string }[];
type AssertNestedJoin = Expect<Equal<NestedJoinResult, NestedJoinExpected>>;

builder
  .innerJoin('users', 'created_by', 'users.id')
  .where('users.email', 'eq', 'team@example.com');

const cteSource = builder.select(['id'] as const).where('price', 'gt', 50);
const cteQuery = builder.withCTE('recent_orders', cteSource).select(['id'] as const);
type CteResult = Awaited<ReturnType<typeof cteQuery.execute>>;
type CteExpected = { id: number }[];
type AssertCteState = Expect<Equal<CteResult, CteExpected>>;

const scalarQuery = builder
  .withScalar('user_name', expr =>
    expr.ch.dictGet<string>('users_dict', 'name', expr.col('created_by'))
  )
  .select(['created_by', 'user_name'] as const)
  .where('user_name', 'like', '%team%')
  .groupBy(['created_by', 'user_name'])
  .orderBy('user_name', 'DESC');
type ScalarQueryResult = Awaited<ReturnType<typeof scalarQuery.execute>>;
type ScalarQueryExpected = { created_by: number; user_name: string }[];
type AssertScalarQuery = Expect<Equal<ScalarQueryResult, ScalarQueryExpected>>;

builder.withScalar('user_name', expr =>
  expr.ch.dictGet('users_dict', 'name', expr.col('created_by'))
);
// @ts-expect-error - scalar alias cannot contain whitespace
builder.withScalar('user name', expr =>
  expr.ch.dictGet('users_dict', 'name', expr.col('created_by'))
);

const aliasJoin = builder
  .innerJoin('users', 'created_by', 'users.id', 'creator')
  .selectConst('creator.user_name');
type AliasJoinResult = Awaited<ReturnType<typeof aliasJoin.execute>>;
type AliasJoinExpected = { user_name: string }[];
type AssertAliasJoin = Expect<Equal<AliasJoinResult, AliasJoinExpected>>;

builder
  .innerJoin('users', 'created_by', 'users.id', 'creator')
  .where('creator.user_name', 'eq', 'team@example.com');

const aliasedRelationQuery = builder.withRelation([
  {
    from: 'test_table',
    to: 'users',
    leftColumn: 'created_by',
    rightColumn: 'id',
    alias: 'creator',
  },
  {
    from: 'creator',
    to: 'test_table',
    leftColumn: 'id',
    rightColumn: 'updated_by',
    alias: 'updated_by_user',
  },
] as const).select(['creator.user_name', 'updated_by_user.name']);
type AliasedRelationResult = Awaited<ReturnType<typeof aliasedRelationQuery.execute>>;
type AliasedRelationExpected = { user_name: string; name: string }[];
type AssertAliasedRelation = Expect<Equal<AliasedRelationResult, AliasedRelationExpected>>;

// @ts-expect-error second relation step cannot start from an unknown source
builder.withRelation([
  {
    from: 'test_table',
    to: 'users',
    leftColumn: 'created_by',
    rightColumn: 'id',
    alias: 'creator',
  },
  {
    from: 'unknown_alias',
    to: 'test_table',
    leftColumn: 'id',
    rightColumn: 'updated_by',
  },
] as const);

const relationships = new JoinRelationships<TestSchema>();
relationships.defineChain('creatorChain', [
  {
    from: 'test_table',
    to: 'users',
    leftColumn: 'created_by',
    rightColumn: 'id',
    alias: 'creator',
  },
  {
    from: 'creator',
    to: 'test_table',
    leftColumn: 'id',
    rightColumn: 'updated_by',
    alias: 'updated_by_user',
  },
] as const);

// @ts-expect-error registry chains must also reference a source introduced earlier in the chain
relationships.defineChain('invalidCreatorChain', [
  {
    from: 'test_table',
    to: 'users',
    leftColumn: 'created_by',
    rightColumn: 'id',
    alias: 'creator',
  },
  {
    from: 'missing_alias',
    to: 'test_table',
    leftColumn: 'id',
    rightColumn: 'updated_by',
  },
] as const);

// --- CTE aliases as typed join targets ---

const activeUsers = builderUsers
  .select(['id', 'user_name'])
  .where('is_active', 'eq', true);

// Columns come from the builder passed to withCTE.
const joinedBuilderCte = builder
  .withCTE('active_users', activeUsers)
  .innerJoin('active_users', 'created_by', 'active_users.id')
  .select(['id', 'active_users.user_name']);
type JoinedBuilderCteResult = Awaited<ReturnType<typeof joinedBuilderCte.execute>>;
type JoinedBuilderCteExpected = { id: number; user_name: string }[];
type AssertJoinedBuilderCte = Expect<
  Equal<JoinedBuilderCteResult, JoinedBuilderCteExpected>
>;

// Columns declared alongside a raw SQL body resolve through the schema vocabulary.
const joinedRawCte = builder
  .withCTE('recent_orders', 'SELECT user_id, total FROM orders', {
    user_id: 'Int32',
    total: 'Float64',
  })
  .innerJoin('recent_orders', 'created_by', 'recent_orders.user_id')
  .select(['id', 'recent_orders.total']);
type JoinedRawCteResult = Awaited<ReturnType<typeof joinedRawCte.execute>>;
type JoinedRawCteExpected = { id: number; total: number }[];
type AssertJoinedRawCte = Expect<Equal<JoinedRawCteResult, JoinedRawCteExpected>>;

// A CTE column can be filtered on once the CTE is joined.
builder
  .withCTE('active_users', activeUsers)
  .innerJoin('active_users', 'created_by', 'active_users.id')
  .where('active_users.user_name', 'eq', 'ada');

builder
  .withCTE('active_users', activeUsers)
  // @ts-expect-error - columns the CTE does not expose are rejected on the join
  .innerJoin('active_users', 'created_by', 'active_users.missing');

builder
  .withCTE('untyped_cte', 'SELECT id FROM users')
  // @ts-expect-error - a raw CTE with no declared columns is not a typed join target
  .innerJoin('untyped_cte', 'created_by', 'untyped_cte.id');

builder
  .withCTE('active_users', activeUsers)
  // @ts-expect-error - a CTE join cannot take a table alias, which resolves through the schema
  .innerJoin('active_users', 'created_by', 'active_users.id', 'au');

// @ts-expect-error - an undeclared CTE name is not joinable
builder.innerJoin('never_declared', 'created_by', 'never_declared.id');

// Schema tables keep their existing join behaviour, aliases included.
const aliasedSchemaJoin = builder
  .withCTE('active_users', activeUsers)
  .innerJoin('users', 'created_by', 'users.id', 'creator')
  .select(['id', 'creator.user_name']);
type AliasedSchemaJoinResult = Awaited<ReturnType<typeof aliasedSchemaJoin.execute>>;
type AliasedSchemaJoinExpected = { id: number; user_name: string }[];
type AssertAliasedSchemaJoin = Expect<
  Equal<AliasedSchemaJoinResult, AliasedSchemaJoinExpected>
>;

// Runtime aliases must not introduce a string index signature into CTE state.
declare const runtimeCteAlias: string;
const dynamicBuilderCte = builder.withCTE(runtimeCteAlias, activeUsers);
const dynamicRawCte = builder.withCTE(runtimeCteAlias, 'SELECT id FROM users', { cte_only: 'Int32' });
const dynamicSchemaJoin = dynamicBuilderCte
  .innerJoin('users', 'created_by', 'users.id', 'creator')
  .select(['id', 'creator.user_name']);
type DynamicSchemaJoinResult = Awaited<ReturnType<typeof dynamicSchemaJoin.execute>>;
type AssertDynamicSchemaJoin = Expect<Equal<DynamicSchemaJoinResult, { id: number; user_name: string }[]>>;
const dynamicRawSchemaJoin = dynamicRawCte
  .innerJoin('users', 'created_by', 'users.id', 'creator')
  .select(['id', 'creator.user_name']);
type DynamicRawSchemaJoinResult = Awaited<ReturnType<typeof dynamicRawSchemaJoin.execute>>;
type AssertDynamicRawSchemaJoin = Expect<Equal<DynamicRawSchemaJoinResult, { id: number; user_name: string }[]>>;
// @ts-expect-error - runtime aliases do not make arbitrary targets joinable
dynamicBuilderCte.innerJoin('undeclared', 'created_by', 'undeclared.id');
// @ts-expect-error - declared raw columns with runtime aliases cannot shadow a real table
dynamicRawCte.innerJoin('users', 'created_by', 'users.cte_only');
// @ts-expect-error - arbitrary targets remain invalid for raw CTEs as well
dynamicRawCte.innerJoin('undeclared', 'created_by', 'undeclared.cte_only');
const literalAfterDynamic = dynamicRawCte
  .withCTE('active_users', activeUsers)
  .innerJoin('active_users', 'created_by', 'active_users.id')
  .select(['id', 'active_users.user_name']);
type LiteralAfterDynamicResult = Awaited<ReturnType<typeof literalAfterDynamic.execute>>;
type AssertLiteralAfterDynamic = Expect<Equal<LiteralAfterDynamicResult, { id: number; user_name: string }[]>>;

// The original API accepts a body selected dynamically between SQL and a builder.
const unionCteBody = Math.random() > 0.5 ? 'SELECT id FROM users' : activeUsers;
builder.withCTE('dynamic_body', unionCteBody).select(['id']);

// A CTE declared before the source becomes a typed query source of its own.
const descendantsScope = db.withRecursiveCTE(
  'descendants',
  {
    sql: `
      SELECT {rootId:UUID} AS id
      UNION ALL
      SELECT link.child_id AS id
      FROM asset_link AS link
      INNER JOIN descendants AS walked ON link.parent_id = walked.id
    `,
    parameters: { rootId: 'b4f7…' },
  },
  { id: 'UUID' },
);
const descendantIds = descendantsScope.table('descendants').select(['id']).distinct();
type DescendantIdsResult = Awaited<ReturnType<typeof descendantIds.execute>>;
type AssertDescendantIds = Expect<Equal<DescendantIdsResult, { id: string }[]>>;

descendantsScope.table('descendants').where('id', 'eq', 'b4f7…');
descendantsScope.table('descendants').select(['descendants.id']);
// @ts-expect-error - columns the CTE does not declare are not selectable
descendantsScope.table('descendants').select(['missing']);
// @ts-expect-error - columns the CTE does not declare are not filterable
descendantsScope.table('descendants').where('missing', 'eq', 1);
// @ts-expect-error - FINAL is only valid for table sources
descendantsScope.table('descendants').final();
// @ts-expect-error - an undeclared name is neither a CTE nor a schema table
descendantsScope.table('not_declared');

// Starting from a schema table keeps schema typing and the CTE stays joinable.
const scopedTableQuery = descendantsScope
  .table('test_table')
  .innerJoin('descendants', 'id', 'descendants.id')
  .select(['name', 'descendants.id']);
type ScopedTableQueryResult = Awaited<ReturnType<typeof scopedTableQuery.execute>>;
type AssertScopedTableQuery = Expect<Equal<ScopedTableQueryResult, { name: string; id: string }[]>>;

// A builder body carries its output type through to the CTE source.
const scopedBuilderCte = db
  .withCTE('active_users', activeUsers)
  .table('active_users')
  .select(['id', 'user_name']);
type ScopedBuilderCteResult = Awaited<ReturnType<typeof scopedBuilderCte.execute>>;
type AssertScopedBuilderCte = Expect<Equal<ScopedBuilderCteResult, { id: number; user_name: string }[]>>;

// A raw body with no declared columns is not a typed source.
// @ts-expect-error - the alias exposes no columns to read from
db.withCTE('untyped_scope', 'SELECT id FROM users').table('untyped_scope');

// The recursive marker is available on the builder too, for a joined CTE.
const recursiveJoin = builder
  .withRecursiveCTE('lineage', 'SELECT 1 AS id UNION ALL SELECT id FROM lineage', { id: 'Int32' })
  .innerJoin('lineage', 'created_by', 'lineage.id')
  .select(['id', 'lineage.id']);
type RecursiveJoinResult = Awaited<ReturnType<typeof recursiveJoin.execute>>;
type AssertRecursiveJoin = Expect<Equal<RecursiveJoinResult, { id: number }[]>>;

// Broad aliases stay untyped on scopes, just as they do on inline builders.
const runtimeScopeAlias: string = 'runtime_cte';
const dynamicBuilderScope = db.withCTE(runtimeScopeAlias, activeUsers);
const dynamicRawScope = db.withCTE(runtimeScopeAlias, 'SELECT 1 AS cte_only', { cte_only: 'UInt32' });
const dynamicRecursiveScope = db.withRecursiveCTE(runtimeScopeAlias, 'SELECT 1 AS cte_only', { cte_only: 'UInt32' });
dynamicBuilderScope.table('users').select(['email']).final();
dynamicRawScope.table('users').select(['email']).final();
dynamicRecursiveScope.table('users').select(['email']).prewhere('id', 'eq', 1).final();
// @ts-expect-error - broad builder aliases do not register arbitrary sources
dynamicBuilderScope.table('undeclared');
// @ts-expect-error - broad raw aliases do not register arbitrary sources
dynamicRawScope.table('undeclared');
// @ts-expect-error - broad recursive aliases do not register arbitrary sources
dynamicRecursiveScope.table('undeclared');
// @ts-expect-error - schema tables must not gain the dynamic CTE's columns
dynamicRawScope.table('users').select(['cte_only']);
const scopeAfterDynamic = descendantsScope
  .withCTE(runtimeScopeAlias, 'SELECT 1 AS cte_only', { cte_only: 'UInt32' })
  .withCTE('active_users', activeUsers);
const existingScopedSource = scopeAfterDynamic.table('descendants').select(['id']);
type AssertExistingScopedSource = Expect<Equal<Awaited<ReturnType<typeof existingScopedSource.execute>>, { id: string }[]>>;
const laterScopedSource = scopeAfterDynamic.table('active_users').select(['user_name']);
type AssertLaterScopedSource = Expect<Equal<Awaited<ReturnType<typeof laterScopedSource.execute>>, { user_name: string }[]>>;
// @ts-expect-error - PREWHERE is only valid for table sources
descendantsScope.table('descendants').prewhere('id', 'eq', 'root');

// Compound raw parameters retain their declared CTE output types.
const compoundScope = db.withCTE('compound', {
  sql: `SELECT {pairs:Array(Tuple(UInt32, String))} AS pairs,
    {records:Array(Tuple(id UInt32, label String))} AS records,
    {maps:Array(Map(String, UInt32))} AS maps`,
  parameters: { pairs: [[1, 'x']], records: [{ id: 1, label: 'x' }], maps: [{ x: 1 }] },
}, {
  pairs: 'Array(Tuple(UInt32, String))',
  records: 'Array(Tuple(id UInt32, label String))',
  maps: 'Array(Map(String, UInt32))',
});
const compoundQuery = compoundScope.table('compound').select(['pairs', 'records', 'maps']);
type AssertCompoundCte = Expect<Equal<Awaited<ReturnType<typeof compoundQuery.execute>>, {
  pairs: [number, string][];
  records: { id: number; label: string }[];
  maps: Record<string, number>[];
}[]>>;
// @ts-expect-error - unknown compound-source columns remain invalid
compoundScope.table('compound').select(['missing']);
const compoundRecursive = db.withRecursiveCTE('recursive_pairs', {
  sql: 'SELECT {pairs:Array(Tuple(UInt32, String))} AS pairs, toUInt8(1) AS n UNION ALL SELECT pairs, toUInt8(n + 1) FROM recursive_pairs WHERE n < 2',
  parameters: { pairs: [[1, 'x']] },
}, { pairs: 'Array(Tuple(UInt32, String))', n: 'UInt8' })
  .table('recursive_pairs').select(['pairs']);
type AssertRecursiveCompoundCte = Expect<Equal<Awaited<ReturnType<typeof compoundRecursive.execute>>, { pairs: [number, string][] }[]>>;

const jsonCte = db.withCTE('json_values', {
  sql: 'SELECT {payload:JSON} AS payload, {values:Array(JSON)} AS values',
  parameters: { payload: { foo: 'bar' }, values: [{ foo: 'bar' }] },
}, { payload: 'JSON', values: 'Array(JSON)' })
  .table('json_values').select(['payload', 'values']);
type AssertJsonCte = Expect<Equal<Awaited<ReturnType<typeof jsonCte.execute>>, { payload: unknown; values: unknown[] }[]>>;
const recursiveJsonCte = db.withRecursiveCTE('recursive_json', {
  sql: 'SELECT {payload:JSON} AS payload, toUInt8(1) AS n UNION ALL SELECT payload, toUInt8(n + 1) FROM recursive_json WHERE n < 2',
  parameters: { payload: { foo: 'bar' } },
}, { payload: 'JSON', n: 'UInt8' })
  .table('recursive_json').select(['payload']);
type AssertRecursiveJsonCte = Expect<Equal<Awaited<ReturnType<typeof recursiveJsonCte.execute>>, { payload: unknown }[]>>;

// Bound client methods retain all overloads without casting their signatures.
const { withCTE: declareCte, withRecursiveCTE: declareRecursiveCte } = db;
const detachedBuilderCte = declareCte('active', activeUsers).table('active').select(['user_name']);
type AssertDetachedBuilderCte = Expect<Equal<Awaited<ReturnType<typeof detachedBuilderCte.execute>>, { user_name: string }[]>>;
const detachedRawCte = declareCte('raw_ids', 'SELECT 1 AS id', { id: 'UInt32' }).table('raw_ids').select(['id']);
type AssertDetachedRawCte = Expect<Equal<Awaited<ReturnType<typeof detachedRawCte.execute>>, { id: number }[]>>;
const detachedRecursiveCte = declareRecursiveCte('uuid_ids', 'SELECT toUUID(\'00000000-0000-0000-0000-000000000001\') AS id', { id: 'UUID' })
  .table('uuid_ids').select(['id']);
type AssertDetachedRecursiveCte = Expect<Equal<Awaited<ReturnType<typeof detachedRecursiveCte.execute>>, { id: string }[]>>;
// @ts-expect-error - a detached untyped declaration does not register a source
declareCte('untyped', 'SELECT 1 AS id').table('untyped');
// @ts-expect-error - the detached recursive method retains column checking
detachedRecursiveCte.select(['missing']);
// @ts-expect-error - state transitions keep the non-table marker
detachedRecursiveCte.where('id', 'eq', 'root').final();

// Aggregate result types follow what ClickHouse returns (checked on 26.6).
type AggSchema = {
  facts: {
    id: 'UInt64';
    qty: 'Int32';
    ratio: 'Float32';
    amount: 'Decimal(10, 2)';
    maybe_qty: 'Nullable(Int32)';
    maybe_ratio: 'Nullable(Float64)';
    flag: 'UInt8';
    seen_at: 'DateTime';
    label: 'LowCardinality(String)';
  };
};
const aggDb = createQueryBuilder<AggSchema>({
  adapter: builder.getAdapter(),
  dialect: builder.getDialect(),
});
const typedAggregates = aggDb.table('facts')
  .sum('qty', 'qty_sum')
  .sum('ratio', 'ratio_sum')
  .sum('amount', 'amount_sum')
  .sum('maybe_qty', 'maybe_qty_sum')
  .sum('maybe_ratio', 'maybe_ratio_sum')
  .avg('qty', 'qty_avg')
  .min('flag', 'flag_min')
  .max('seen_at', 'seen_max')
  .min('maybe_qty', 'maybe_qty_min')
  .argMax('label', 'seen_at', 'latest_label')
  .quantile('ratio', 0.95, 'ratio_p95')
  .quantile('seen_at', 0.5, 'seen_median')
  .stddev('ratio', 'ratio_stddev')
  .variance('qty', 'qty_variance')
  .approxCountDistinct('label', 'labels')
  .count('id', 'rows');
type TypedAggregatesResult = Awaited<ReturnType<typeof typedAggregates.execute>>;
type TypedAggregatesExpected = {
  qty_sum: string; // Int32 sums widen to Int64, which the adapter quotes
  ratio_sum: number; // Float sums are Float64
  amount_sum: number; // Decimal sums are Decimal(38, S), a JSON number
  maybe_qty_sum: string | null; // NULL when every value is NULL
  maybe_ratio_sum: number | null;
  qty_avg: number | null; // NaN (null) over zero rows
  flag_min: number; // the column's own type
  seen_max: string;
  maybe_qty_min: number | null;
  latest_label: string;
  ratio_p95: number | null; // Float64, NULL over zero rows
  seen_median: string | null; // dates keep their own type
  ratio_stddev: number | null; // NULL for fewer than two rows
  qty_variance: number | null;
  labels: string; // uniq() is a quoted UInt64
  rows: string; // count() is a quoted UInt64
}[];
type AssertTypedAggregates = Expect<Equal<TypedAggregatesResult, TypedAggregatesExpected>>;

// Generated schemas include AggregatingMergeTree columns.
type RollupSchema = {
  events_daily: {
    day: 'Date';
    app: 'LowCardinality(String)';
    unique_users: 'AggregateFunction(uniq, UInt64)';
    bytes: 'SimpleAggregateFunction(sum, UInt64)';
    peak: 'SimpleAggregateFunction(max, Float64)';
  };
};
const rollupDb = createQueryBuilder<RollupSchema>({
  adapter: builder.getAdapter(),
  dialect: builder.getDialect(),
});
const rollupRows = rollupDb.table('events_daily').select(['day', 'app', 'bytes', 'peak', 'unique_users']);
type RollupRowsResult = Awaited<ReturnType<typeof rollupRows.execute>>;
type RollupRowsExpected = { day: string; app: string; bytes: string; peak: number; unique_users: string }[];
type AssertRollupRows = Expect<Equal<RollupRowsResult, RollupRowsExpected>>;

const rollupTotals = rollupDb.table('events_daily')
  .select(['app'])
  .sum('bytes', 'total_bytes')
  .max('peak', 'max_peak')
  .mergeState('uniq', 'unique_users', 'users');
type RollupTotalsResult = Awaited<ReturnType<typeof rollupTotals.execute>>;
type RollupTotalsExpected = { app: string; total_bytes: string; max_peak: number; users: string }[];
type AssertRollupTotals = Expect<Equal<RollupTotalsResult, RollupTotalsExpected>>;

// Through a subquery only TypeScript types survive, so results stay conservative.
type DerivedSchema = {
  facts: { id: 'UInt64'; seen_at: 'DateTime'; maybe_big: 'Nullable(UInt64)'; ratio: 'Float64' };
};
const derivedDb = createQueryBuilder<DerivedSchema>({
  adapter: builder.getAdapter(),
  dialect: builder.getDialect(),
});
const derivedInner = derivedDb.table('facts').select(['id', 'seen_at', 'maybe_big', 'ratio']);
const derivedAggregates = derivedDb.from(derivedInner)
  .quantile('seen_at', 0.5, 'seen_median')
  .quantile('ratio', 0.5, 'ratio_median')
  .sum('maybe_big', 'big_sum');
type DerivedAggregatesResult = Awaited<ReturnType<typeof derivedAggregates.execute>>;
type DerivedAggregatesExpected = {
  seen_median: number | string | null; // a date string, or a Float64 for a 64-bit integer
  ratio_median: number | null;
  big_sum: string | null; // NULL when every value is NULL
}[];
type AssertDerivedAggregates = Expect<Equal<DerivedAggregatesResult, DerivedAggregatesExpected>>;
