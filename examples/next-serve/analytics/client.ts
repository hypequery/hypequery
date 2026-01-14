import { createQueryBuilder } from '@hypequery/clickhouse';
import type { IntrospectedSchema } from './schema.js';

export const db = createQueryBuilder<IntrospectedSchema>({
  url: 'https://vjisi2o5nv.eu-west-1.aws.clickhouse.cloud:8443',
  database: 'nyc_taxi',
  username: 'default',
  password: 'ad1L2uH.4A.Sj'
});

