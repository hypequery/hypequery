/**
 * Schema-typed builders must be accepted by the @hypequery/datasets semantic
 * entry points without casts. The strict `QueryBuilderFactoryLike` protocol is
 * not structurally satisfiable by a typed builder (literal column params,
 * concrete `execute()` row types, overloaded `where`), so acceptance points
 * take `QueryBuilderFactoryInput` instead — this file pins that contract.
 */
import { createQueryBuilder } from '../src/core/query-builder.js';
import { createDatasetClient } from '@hypequery/datasets';
import type {
  CreateDatasetClientOptions,
  ExecutionContext,
  QueryBuilderFactoryInput,
} from '@hypequery/datasets';

interface TypedSchema {
  orders: {
    id: 'UInt64';
    status: 'String';
    amount: 'Float64';
    created_at: 'DateTime';
  };
}

const typedDb = createQueryBuilder<TypedSchema>({ url: 'http://localhost:8123' });

// A schema-typed builder is a valid factory input...
const acceptedInput: QueryBuilderFactoryInput = typedDb;

// ...directly in client options...
const acceptedOptions: CreateDatasetClientOptions = { queryBuilder: typedDb };
const client = createDatasetClient({ queryBuilder: typedDb });

// ...and as a per-call runtime builder override.
const acceptedContext: ExecutionContext = {
  runtime: { builderFactory: typedDb },
};

// Non-builder values are still rejected.
// @ts-expect-error a plain object is not a query builder factory
const rejectedObject: QueryBuilderFactoryInput = { foo: 1 };
// @ts-expect-error a ClickHouse client (query/exec, no table) is not a factory
const rejectedClient: QueryBuilderFactoryInput = { query() { }, exec() { } };

void acceptedInput;
void acceptedOptions;
void client;
void acceptedContext;
void rejectedObject;
void rejectedClient;
