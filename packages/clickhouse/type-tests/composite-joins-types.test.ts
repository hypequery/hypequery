import { createQueryBuilder, type QueryBuilder } from '../src/core/query-builder.js';
import { setupTestBuilder, setupUsersBuilder, type TestSchema } from '../src/core/tests/test-utils.js';
import type { JoinKeyPairs } from '../src/index.js';
import type { Equal, Expect } from '@type-challenges/utils';

const builder = setupTestBuilder();
type State = typeof builder extends QueryBuilder<TestSchema, infer S> ? S : never;
const keys = [['created_by', 'users.id'], ['name', 'users.user_name']] as const satisfies JoinKeyPairs<State, 'users'>;

const joined = builder.innerJoin('users', keys, 'u').select(['id', 'u.email']);
type _Joined = Expect<Equal<Awaited<ReturnType<typeof joined.execute>>, { id: number; email: string }[]>>;
const left = builder.leftJoin('users', keys, 'u', { column: 'u.is_active', operator: 'eq', value: true });
const anyJoin = builder.leftAnyJoin('users', keys, 'u');
const right = builder.rightJoin('users', keys, 'u');
const full = builder.fullJoin('users', keys, 'u');
left.select(['u.email']);
anyJoin.select(['u.email']);
right.select(['u.email']);
full.select(['u.email']);

const rawCte = builder.withCTE('children', 'SELECT parent_id, label FROM children', {
  parent_id: 'Int32', label: 'String',
});
const cteKeys = [['id', 'children.parent_id'], ['name', 'children.label']] as const;
const cteQuery = rawCte.leftAnyJoin('children', cteKeys).select(['id', 'children.label']);
type _Cte = Expect<Equal<Awaited<ReturnType<typeof cteQuery.execute>>, { id: number; label: string }[]>>;
rawCte.innerJoin('children', cteKeys);
rawCte.leftJoin('children', cteKeys, undefined, { column: 'children.label', operator: 'eq', value: 'shown' });
rawCte.rightJoin('children', cteKeys);
rawCte.fullJoin('children', cteKeys);

builder.withCTE('people', setupUsersBuilder().select(['id', 'user_name']))
  .leftAnyJoin('people', [['created_by', 'people.id'], ['name', 'people.user_name']]);
const db = createQueryBuilder<TestSchema>({ adapter: builder.getAdapter(), dialect: builder.getDialect() });
db.withCTE('base', 'SELECT id, name FROM test_table', { id: 'Int32', name: 'String' })
  .table('base').innerJoin('users', [['id', 'users.id'], ['name', 'users.user_name']]);

// Each method rejects columns outside the base row or chosen target.
// @ts-expect-error unknown left column
builder.innerJoin('users', [['missing', 'users.id']]);
// @ts-expect-error unknown right column
builder.leftJoin('users', [['id', 'users.missing']]);
// @ts-expect-error wrong qualifier cannot widen the target
builder.leftAnyJoin('users', [['id', 'test_table.id']]);
// @ts-expect-error mixed targets cannot widen the target
builder.rightJoin('users', [['id', 'users.id'], ['id', 'test_table.id']]);
// @ts-expect-error unqualified right columns are rejected
builder.fullJoin('users', [['id', 'id']]);
// @ts-expect-error empty keys
builder.innerJoin('users', []);
// @ts-expect-error incomplete pair
builder.leftJoin('users', [['id']]);
// @ts-expect-error extra tuple element
builder.leftAnyJoin('users', [['id', 'users.id', 'users.email']]);
// @ts-expect-error wrong column on second pair
builder.innerJoin('users', [['id', 'users.id'], ['name', 'users.missing']]);
// @ts-expect-error aliased right input must still use the table qualifier
builder.innerJoin('users', [['id', 'u.id']], 'u');
// @ts-expect-error CTE aliases remain unsupported
rawCte.leftAnyJoin('children', cteKeys, 'c');
// @ts-expect-error unknown CTE column
rawCte.innerJoin('children', [['id', 'children.missing']]);
// @ts-expect-error undeclared CTE
builder.leftAnyJoin('undeclared', [['id', 'undeclared.id']]);
// @ts-expect-error untyped raw CTE
builder.withCTE('untyped', 'SELECT id FROM users').innerJoin('untyped', [['id', 'untyped.id']]);

// Existing argument positions, literal ON inputs and return inference are retained.
builder.innerJoin('users', 'created_by', 'users.id', 'u').select(['u.email']);
builder.leftJoin('users', 'created_by', 'users.id', 'u', { column: 'u.email', operator: 'eq', value: 'x' });
builder.leftAnyJoin('users', 'created_by', 'users.id', 'u', [{ column: 'u.email', operator: 'eq', value: 'x' }]);
builder.rightJoin('users', 'created_by', 'users.id', 'u').select(['u.email']);
builder.fullJoin('users', 'created_by', 'users.id', 'u').select(['u.email']);

// The ticket's complete three-component key, without any casts.
type EntitySchema = {
  entities: { tenant_id: 'UInt32'; entity_id: 'UInt32'; sub_id: 'UInt32' };
};
const entitiesDb = createQueryBuilder<EntitySchema>({ adapter: builder.getAdapter(), dialect: builder.getDialect() });
const entityQuery = entitiesDb.table('entities').withCTE('children_cte', 'SELECT tenant_id, entity_id, parent_sub_id, document FROM children', {
  tenant_id: 'UInt32', entity_id: 'UInt32', parent_sub_id: 'UInt32', document: 'String',
}).leftAnyJoin('children_cte', [
  ['tenant_id', 'children_cte.tenant_id'],
  ['entity_id', 'children_cte.entity_id'],
  ['sub_id', 'children_cte.parent_sub_id'],
]).select(['tenant_id', 'entity_id', 'sub_id', 'children_cte.document']);
type _EntityResult = Expect<Equal<Awaited<ReturnType<typeof entityQuery.execute>>, {
  tenant_id: number; entity_id: number; sub_id: number; document: string;
}[]>>;

// All methods preserve the selected result shape through their alias transition.
const leftResult = left.select(['id', 'u.email']);
const anyResult = anyJoin.select(['id', 'u.email']);
const rightResult = right.select(['id', 'u.email']);
const fullResult = full.select(['id', 'u.email']);
type _Left = Expect<Equal<Awaited<ReturnType<typeof leftResult.execute>>, { id: number; email: string }[]>>;
type _Any = Expect<Equal<Awaited<ReturnType<typeof anyResult.execute>>, { id: number; email: string }[]>>;
type _Right = Expect<Equal<Awaited<ReturnType<typeof rightResult.execute>>, { id: number; email: string }[]>>;
type _Full = Expect<Equal<Awaited<ReturnType<typeof fullResult.execute>>, { id: number; email: string }[]>>;

// @ts-expect-error third left component must belong to the base row
builder.fullJoin('users', [['id', 'users.id'], ['name', 'users.user_name'], ['missing', 'users.created_at']]);
// @ts-expect-error left column from a joined table is outside the existing base-row contract
joined.leftAnyJoin('users', [['u.id', 'users.id']]);
// @ts-expect-error right input is still checked for a builder-derived CTE
builder.withCTE('people', setupUsersBuilder().select(['id'])).leftJoin('people', [['id', 'people.email']]);
// @ts-expect-error widened arrays do not establish a non-empty, checked tuple list
builder.innerJoin('users', [['id', 'users.id']] as string[][]);
// @ts-expect-error literal ON conditions remain available only on LEFT / LEFT ANY
builder.rightJoin('users', keys, 'u', { column: 'u.email', operator: 'eq', value: 'x' });

// Also compile the live examples: their query calls must not depend on ts-nocheck.
type _LiveCompositeJoinExamples = typeof import('../src/core/tests/integration/composite-joins.test.js');
