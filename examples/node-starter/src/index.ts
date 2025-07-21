import { createQueryBuilder } from '@hypequery/clickhouse';
import type { IntrospectedSchema } from './schema.js';

const db = createQueryBuilder<IntrospectedSchema>({
  client: '' as any,
});

const table = db.table('otel_logs')
//@ts-expect-error - This should fail type checking
const validResults = await table.select(['foo', 'bar']).where('foo', 'eq', 'bar').toSQL();
console.log('Valid SQL Query:', validResults);
