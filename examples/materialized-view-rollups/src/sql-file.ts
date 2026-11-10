import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ClickHouseClient } from '@clickhouse/client';

const sqlDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'sql');

/** Split a .sql file on `;` outside quotes, dropping `--` comments. */
export function splitStatements(sql: string): string[] {
  const out: string[] = [];
  let current = '';
  let quote: string | null = null;
  for (let i = 0; i < sql.length; i += 1) {
    const ch = sql[i];
    if (quote) {
      current += ch;
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '-' && sql[i + 1] === '-') {
      const end = sql.indexOf('\n', i);
      i = end === -1 ? sql.length : end;
      continue;
    }
    if (ch === "'" || ch === '`') quote = ch;
    if (ch === ';') {
      if (current.trim()) out.push(current.trim());
      current = '';
      continue;
    }
    current += ch;
  }
  if (current.trim()) out.push(current.trim());
  return out;
}

/** Run every statement of `sql/<name>` in order. */
export async function runSqlFile(client: ClickHouseClient, name: string): Promise<number> {
  const statements = splitStatements(fs.readFileSync(path.join(sqlDir, name), 'utf8'));
  for (const statement of statements) {
    await client.command({ query: statement });
  }
  return statements.length;
}
