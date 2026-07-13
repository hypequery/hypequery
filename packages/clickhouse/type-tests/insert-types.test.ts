import { createQueryBuilder } from '../src/index.js';
import type { InsertJsonValue, InsertRow, InsertResultSummary } from '../src/index.js';
import type { TestSchema } from '../src/core/tests/test-utils.js';
import type { Equal, Expect } from '@type-challenges/utils';

const db = createQueryBuilder<TestSchema>({
  adapter: {
    name: 'type-test',
    query: async () => [],
  },
});

// --- Full-width row shape: Nullable columns optional, others required, widened inputs.

type UsersInsert = InsertRow<TestSchema['users']>;
type ExpectedUsersInsert = {
  id: number;
  user_name: string;
  email: string;
  created_at: string; // Date columns take 'YYYY-MM-DD' strings only — JSONEachRow rejects datetime strings
  profile: Record<string, string>;
  roles: string[];
  is_active: boolean;
  preferences?: Record<string, string> | null;
};
type AssertUsersInsert = Expect<Equal<UsersInsert, ExpectedUsersInsert>>;

// Large integers accept string | number | bigint; DateTime stays wide, Date stays string-only.
type EventsSchema = {
  events: {
    id: 'Int64';
    ts: 'DateTime';
    day: 'Date';
    note: 'Nullable(String)';
  };
};
type EventsInsert = InsertRow<EventsSchema['events']>;
type ExpectedEventsInsert = {
  id: string | number | bigint;
  ts: string | Date | number;
  day: string;
  note?: string | null;
};
type AssertEventsInsert = Expect<Equal<EventsInsert, ExpectedEventsInsert>>;

// Generator-supported specialized and composite types stay insertable.
type GeneratedTypesSchema = {
  generated_types: {
    ip: 'IPv6';
    money: 'Decimal128(8)';
    pair: 'Tuple(String, UInt64)';
    events: 'Array(Tuple(DateTime64(3), String))';
    attributes: 'Map(String, Nullable(Int64))';
    payload: 'JSON';
  };
};
type GeneratedTypesInsert = InsertRow<GeneratedTypesSchema['generated_types']>;
type ExpectedGeneratedTypesInsert = {
  ip: string;
  money: number | string;
  pair: [string, string | number | bigint];
  events: Array<[string | Date | number, string]>;
  attributes: Record<string, string | number | bigint | null>;
  payload: InsertJsonValue;
};
type AssertGeneratedTypesInsert = Expect<Equal<
  GeneratedTypesInsert,
  ExpectedGeneratedTypesInsert
>>;

// --- Valid inserts.

const fullInsert = db.insert('users').values({
  id: 1,
  user_name: 'ada',
  email: 'ada@example.com',
  created_at: '2026-01-01',
  profile: { plan: 'pro' },
  roles: ['admin'],
  is_active: true,
});
type ExecuteResult = Awaited<ReturnType<typeof fullInsert.execute>>;
type AssertExecuteResult = Expect<Equal<ExecuteResult, InsertResultSummary>>;

// Nullable columns can be set explicitly to null.
db.insert('users').values({
  id: 2,
  user_name: 'grace',
  email: 'grace@example.com',
  created_at: '2026-01-01',
  profile: {},
  roles: [],
  is_active: false,
  preferences: null,
});

// Full test_table row: Date object accepted for DateTime64, maps/arrays typed, optional columns omitted.
db.insert('test_table').values({
  id: 1,
  name: 'widget',
  price: 9.99,
  created_at: '2026-01-01',
  category: 'tools',
  active: 1,
  created_by: 1,
  updated_by: 1,
  status: 'new',
  brand: 'acme',
  total: 10,
  priority: 'high',
  is_premium: true,
  metadata: { source: 'test' },
  tags: ['a', 'b'],
  settings: { theme: 'dark' },
  categories: ['tools'],
  feature_flags: [{ beta: 'on' }],
  permissions: { admin: ['read', 'write'] },
  created_timestamp: new Date(),
});

// --- Column subsets.

const subset = db.insert('users').columns(['id', 'user_name']);
subset.values({ id: 1, user_name: 'ada' });
subset.values([{ id: 1, user_name: 'ada' }, { id: 2, user_name: 'grace' }]);

// Nullable columns stay optional inside a subset.
db.insert('users').columns(['id', 'user_name', 'preferences']).values({ id: 1, user_name: 'ada' });

// --- Compile-time failures.

// @ts-expect-error - unknown table
db.insert('nope');

// @ts-expect-error - missing required columns
db.insert('users').values({ id: 1 });

// @ts-expect-error - wrong value type for a column
db.insert('users').values({ id: 'not-a-number', user_name: 'ada', email: 'a@b.c', created_at: '2026-01-01', profile: {}, roles: [], is_active: true });

// @ts-expect-error - unknown column in the row literal
db.insert('users').values({ id: 1, user_name: 'ada', email: 'a@b.c', created_at: '2026-01-01', profile: {}, roles: [], is_active: true, nope: 1 });

// @ts-expect-error - non-nullable column rejects null
db.insert('users').values({ id: null, user_name: 'ada', email: 'a@b.c', created_at: '2026-01-01', profile: {}, roles: [], is_active: true });

// @ts-expect-error - Date objects are rejected for Date columns (JSONEachRow only parses 'YYYY-MM-DD')
db.insert('users').values({ id: 1, user_name: 'ada', email: 'a@b.c', created_at: new Date(), profile: {}, roles: [], is_active: true });

// @ts-expect-error - unknown column in columns()
db.insert('users').columns(['nope']);

// @ts-expect-error - column outside the selected subset
subset.values({ id: 1, user_name: 'ada', email: 'a@b.c' });

// @ts-expect-error - subset makes unselected required columns unacceptable, not optional
subset.values({ id: 1 });
