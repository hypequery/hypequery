import { createQueryBuilder } from '@hypequery/clickhouse';
import { createClient } from '@clickhouse/client';

import type { AnalyticsSchema } from './schema.js';

const url =
  process.env.CLICKHOUSE_URL ??
  process.env.CLICKHOUSE_HOST ??
  'http://localhost:8123';

const username = process.env.CLICKHOUSE_USERNAME ?? 'default';
const password = process.env.CLICKHOUSE_PASSWORD ?? '';
const database = process.env.CLICKHOUSE_DATABASE ?? 'default';

const client = createClient({ url, username, password, database });

export const db = createQueryBuilder<AnalyticsSchema>({ client });
