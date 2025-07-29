import { createQueryBuilder } from '@hypequery/clickhouse';
import type { IntrospectedSchema } from './schema.js';

const db = createQueryBuilder<IntrospectedSchema>({
  client: '' as any,
});

const table = db.table('otel_logs')
const validResults = await table.select(['ResourceAttributes', 'Body', 'ScopeVersion', 'ScopeName']).limit(100).execute();
console.log('Valid SQL Query:', validResults);

const test = await table.select(['system.test_table.ScopeAttributes']).execute()
