export interface ClientTemplateOptions {
  database?: 'clickhouse' | 'chdb';
  /** On-disk chDB session directory; omit for an in-memory session. */
  chdbPath?: string;
}

/**
 * Generate client.ts file for ClickHouse (HTTP) or embedded chDB
 */
export function generateClientTemplate(options: ClientTemplateOptions = {}): string {
  if (options.database === 'chdb') {
    const sessionArg = options.chdbPath ? `'${options.chdbPath}'` : '';
    const storageComment = options.chdbPath
      ? `// Embedded ClickHouse — data persists in ${options.chdbPath}`
      : '// Embedded ClickHouse — in-memory session (data is discarded on exit).\n// Pass a directory path to new Session(...) to persist between runs.';
    return `import { createQueryBuilder } from '@hypequery/clickhouse';
import { Session } from 'chdb';
import { chdbAdapter } from 'chdb/hypequery';
import type { IntrospectedSchema } from './schema.js';

${storageComment}
export const session = new Session(${sessionArg});

export const db = createQueryBuilder<IntrospectedSchema>({
  adapter: chdbAdapter({ session }),
});
`;
  }

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
