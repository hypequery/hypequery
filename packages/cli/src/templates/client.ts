/**
 * Generate client.ts file for ClickHouse
 */
export function generateClientTemplate(): string {
  return `import { createQueryBuilder } from '@hypequery/clickhouse';
import type { IntrospectedSchema } from './schema.js';

export const db = createQueryBuilder<IntrospectedSchema>();
`;
}
