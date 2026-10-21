import { createDatasetClient, type QueryBuilderFactoryLike, type QueryBuilderLike } from '../src/index.js';

declare const builder: QueryBuilderLike;
declare const factory: QueryBuilderFactoryLike;

// The callback renderer is optional, so existing protocol builders still conform.
const legacy: QueryBuilderLike = { ...builder, toSQLWithPlaceholders: undefined };
createDatasetClient({ queryBuilder: factory });

// A conforming implementation receives each value and returns SQL text.
const conforming: QueryBuilderLike = {
  ...builder,
  toSQLWithPlaceholders: (placeholder: (value: unknown) => string) => `a = ${placeholder(1)}`,
};
const sql: string | undefined = builder.toSQLWithPlaceholders?.(() => '?');

// @ts-expect-error The renderer must return SQL text.
const wrongReturn: QueryBuilderLike = { ...builder, toSQLWithPlaceholders: () => 1 };
// @ts-expect-error The callback must return the placeholder text for a value.
const wrongCallback: QueryBuilderLike = { ...builder, toSQLWithPlaceholders: (placeholder: (value: unknown) => number) => String(placeholder(1)) };

void legacy;
void conforming;
void sql;
void wrongReturn;
void wrongCallback;
