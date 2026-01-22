import { QueryBuilder } from '../src/core/query-builder.js';
import type { BuilderState } from '../src/core/types/builder-state.js';
import type { TableColumn, TableRecord } from '../src/types/schema.js';
import { buildRuntimeContext, resolveCacheConfig } from '../src/core/cache/runtime-context.js';

// Simple helper utilities for compile-time assertions
// The compiler will emit errors if any of these constraints fail, giving us type regression coverage.
type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false;
type Expect<T extends true> = T;

type AppSchema = {
  users: {
    id: 'Int32';
    name: 'String';
    created_at: 'DateTime';
    age: 'UInt32';
  };
  events: {
    event_id: 'UUID';
    user_id: 'Int32';
    ts: 'DateTime64(3)';
  };
};

type UsersRecord = TableRecord<AppSchema['users']>;
type EventsRecord = TableRecord<AppSchema['events']>;

// Validate column inference from ClickHouse primitives
type _UsersIdIsNumber = Expect<Equal<UsersRecord['id'], number>>;
type _UsersCreatedAtIsString = Expect<Equal<UsersRecord['created_at'], string>>;
type _EventsTimestampIsString = Expect<Equal<EventsRecord['ts'], string>>;

// Validate TableColumn helper emits both qualified + bare column unions
type ExpectedColumns =
  | 'users.id' | 'users.name' | 'users.created_at' | 'users.age'
  | 'events.event_id' | 'events.user_id' | 'events.ts'
  | 'id' | 'name' | 'created_at' | 'age'
  | 'event_id' | 'user_id' | 'ts';
type _TableColumnShape = Expect<Equal<TableColumn<AppSchema>, ExpectedColumns>>;

// Instantiate a QueryBuilder purely for type checking
type UsersState = BuilderState<
  AppSchema,
  'users',
  TableRecord<AppSchema['users']>,
  'users'
>;

const runtime = buildRuntimeContext(resolveCacheConfig(undefined, 'type-tests'));

const qb = new QueryBuilder<AppSchema, UsersState>(
  'users',
  {
    schema: {} as AppSchema,
    tables: 'users',
    output: {} as TableRecord<AppSchema['users']>,
    baseTable: 'users',
    base: {} as AppSchema['users'],
    aliases: {}
  },
  runtime
);

const selected = qb.select(['id', 'name']);
type SelectedRow = Awaited<ReturnType<typeof selected['execute']>>[number];
type _SelectedRowShape = Expect<Equal<SelectedRow, { id: number; name: string }>>;

// Ensure numeric comparisons remain type-safe
qb.where('age', 'gt', 18);
// @ts-expect-error - LIKE should not accept numeric columns
qb.where('age', 'like', 'abc');

// Ensure joins accept qualified column references
qb.innerJoin('events', 'id', 'events.user_id');
