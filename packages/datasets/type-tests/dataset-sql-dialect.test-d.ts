import {
  createDatasetClient,
  type DatasetSqlDialect,
  type QueryBuilderFactoryCompatible,
  type QueryBuilderFactoryLike,
} from '../src/index.js';

declare const legacyFactory: QueryBuilderFactoryLike;
declare const typedFactory: QueryBuilderFactoryCompatible;
const dialect: DatasetSqlDialect = {
  name: 'clickhouse',
  quoteIdentifier: identifier => `\`${identifier}\``,
};

// Both existing structural shapes accept the optional rendering metadata.
createDatasetClient({ queryBuilder: legacyFactory });
createDatasetClient({ queryBuilder: { ...legacyFactory, datasetSqlDialect: dialect } });
const client = createDatasetClient({
  queryBuilder: { ...typedFactory, datasetSqlDialect: dialect },
});
declare const target: Parameters<typeof client.toSQL>[0];
client.toSQL(target, {}, {
  runtime: { builderFactory: { ...typedFactory, datasetSqlDialect: dialect } },
});

// @ts-expect-error Dialect hooks must return SQL text.
const invalidDialect: DatasetSqlDialect = { name: 'invalid', quoteIdentifier: () => 1 };
void invalidDialect;
