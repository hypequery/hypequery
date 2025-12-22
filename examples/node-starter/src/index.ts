import { createQueryBuilder } from '@hypequery/clickhouse';
import type { IntrospectedSchema } from './schema.js';

const db = createQueryBuilder<IntrospectedSchema>({
  client: '' as any,
});

const table = db.table('otel_logs')
const validResults = await table.leftJoin('test_logs', 'Body', 'test_logs.LogName').select(['ResourceAttributes', 'Body', 'ScopeVersion', 'test_logs.LogDescription']).limit(100).execute();

const validResults2 = await table.select('*').limit(100).execute();
console.log('Valid SQL Query:', validResults, validResults2);
