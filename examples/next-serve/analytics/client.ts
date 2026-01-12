import { createQueryBuilder } from '@hypequery/clickhouse';
import type { IntrospectedSchema } from './schema.js';

export const db = createQueryBuilder<IntrospectedSchema>();
