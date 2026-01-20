import { createQueryBuilder } from '@hypequery/clickhouse';
import type { IntrospectedSchema } from './schema.js';

const required = (key: string) => {
  const value = process.env[key];
  if (!value) {
    throw new Error(`Missing ${key} in environment. Copy .env.example to .env and fill it in.`);
  }
  return value;
};

export const db = createQueryBuilder<IntrospectedSchema>({
  url: required('CLICKHOUSE_URL'),
  database: process.env.CLICKHOUSE_DATABASE ?? 'default',
  username: process.env.CLICKHOUSE_USERNAME ?? 'default',
  password: process.env.CLICKHOUSE_PASSWORD ?? ''
});
