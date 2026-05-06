/**
 * Generate client.ts file for ClickHouse
 */
export function generateClientTemplate(): string {
  return `import { createQueryBuilder } from '@hypequery/clickhouse';
import type { IntrospectedSchema } from './schema.js';

export const db = createQueryBuilder<IntrospectedSchema>({
  url: process.env.CLICKHOUSE_URL ?? process.env.CLICKHOUSE_HOST!,
  database: process.env.CLICKHOUSE_DATABASE!,
  username: process.env.CLICKHOUSE_USERNAME!,
  password: process.env.CLICKHOUSE_PASSWORD,
});
`;
}
