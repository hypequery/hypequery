import { createDatasetClient } from '@hypequery/datasets';
import type { QueryBuilderFactoryLike, QueryBuilderLike } from '@hypequery/datasets/internal';
import pg from 'pg';
import { createPostgresQueryBuilder, PostgresQueryBuilder, type PgPoolLike } from '../src/index.js';

// The builder satisfies the datasets protocol structurally, every optional member included.
const factory = createPostgresQueryBuilder();
export const asFactory: QueryBuilderFactoryLike = factory;
export const asBuilder: QueryBuilderLike = factory.table('t');
export const leftAnyJoin: NonNullable<QueryBuilderLike['leftAnyJoin']> = factory.table('t').leftAnyJoin.bind(factory.table('t'));
export const builder: PostgresQueryBuilder = factory.table('t');

// A node-postgres Pool is accepted as-is.
export const pool: PgPoolLike = new pg.Pool();
export const fromPool = createPostgresQueryBuilder({ pool: new pg.Pool(), statementTimeoutMs: 5_000 });

// And the factory plugs straight into the canonical datasets entry point.
export const client = createDatasetClient({ queryBuilder: createPostgresQueryBuilder({ pool: new pg.Pool() }) });

// @ts-expect-error a driver must implement query()
createPostgresQueryBuilder({ driver: {} });
