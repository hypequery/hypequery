/**
 * Generate client.ts file for ClickHouse
 */
export function generateClientTemplate() {
    return "import { createQueryBuilder } from '@hypequery/clickhouse';\nimport type { IntrospectedSchema } from './schema';\n\nexport const db = createQueryBuilder<IntrospectedSchema>({\n  host: process.env.CLICKHOUSE_HOST!,\n  database: process.env.CLICKHOUSE_DATABASE!,\n  username: process.env.CLICKHOUSE_USERNAME!,\n  password: process.env.CLICKHOUSE_PASSWORD,\n});\n";
}
