/**
 * Runs the SQL example of every indexed ClickHouse function page against one
 * or more ClickHouse binaries and reports which versions run each example.
 * The function pages state behaviour "checked on ClickHouse 26.6"; this is how
 * that check is repeated when a new ClickHouse release comes out.
 *
 * Usage (from website-next/):
 *   npm run check:functions
 *   CLICKHOUSE_BINARIES="/opt/ch/26.6/clickhouse,/opt/ch/26.10/clickhouse" npm run check:functions
 *
 * Each binary is run as `<binary> local`, so no server is needed. Exit code is
 * 1 if any example fails on any binary.
 */
import { execFileSync } from 'node:child_process';
import { clickhouseFunctions, indexedFunctionSlugs } from '../src/data/clickhouse-functions';

// Tables the examples query, with a few rows each so every example returns data.
const FIXTURES = `
CREATE TABLE events (id UInt64, user_id UInt64, event_name String, created_at DateTime) ENGINE = MergeTree ORDER BY created_at;
INSERT INTO events SELECT number, number % 7, ['view', 'click', 'buy'][number % 3 + 1], toDateTime('2026-03-01 00:00:00') + number * 600 FROM numbers(500);
CREATE TABLE users (external_id String, email String) ENGINE = MergeTree ORDER BY external_id;
INSERT INTO users SELECT toString(number), concat('user', toString(number), '@example.com') FROM numbers(7);
CREATE TABLE orders (order_id UInt64, created_at DateTime, amount_cents Int64, status String, checkout_ms UInt32) ENGINE = MergeTree ORDER BY created_at;
INSERT INTO orders SELECT number, toDateTime('2026-03-01 00:00:00') + number * 3600, 1000 + number, ['paid', 'refunded'][number % 2 + 1], number % 900 FROM numbers(200);
CREATE TABLE api_requests (ts DateTime, response_ms UInt32) ENGINE = MergeTree ORDER BY ts;
INSERT INTO api_requests SELECT toDateTime('2026-03-01 00:00:00') + number * 10, number % 500 FROM numbers(1000);
CREATE TABLE page_views (session_id String, ts DateTime, page_path String) ENGINE = MergeTree ORDER BY ts;
INSERT INTO page_views SELECT toString(number % 5), toDateTime('2026-03-01 00:00:00') + number, ['/z', '/a', '/m'][number % 3 + 1] FROM numbers(60);
CREATE TABLE exam_results (student_id UInt64, score UInt8) ENGINE = MergeTree ORDER BY student_id;
INSERT INTO exam_results SELECT number, number % 101 FROM numbers(300);
`;

type Result = { slug: string; binary: string; version: string; ok: boolean; error?: string };

function run(binary: string, sql: string): string {
  return execFileSync(binary, ['local', '--multiquery', '--query', sql], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

const binaries = (process.env.CLICKHOUSE_BINARIES ?? 'clickhouse')
  .split(',')
  .map((b) => b.trim())
  .filter(Boolean);

const results: Result[] = [];
for (const binary of binaries) {
  const version = run(binary, 'SELECT version()').trim();
  for (const fn of clickhouseFunctions.filter((f) => indexedFunctionSlugs.has(f.slug))) {
    try {
      run(binary, `${FIXTURES}\n${fn.exampleSql}`);
      results.push({ slug: fn.slug, binary, version, ok: true });
    } catch (error) {
      const stderr = (error as { stderr?: string }).stderr ?? String(error);
      results.push({ slug: fn.slug, binary, version, ok: false, error: stderr.split('\n')[0] });
    }
  }
}

for (const r of results) {
  console.log(`${r.ok ? 'ok  ' : 'FAIL'}  ClickHouse ${r.version}  ${r.slug}${r.error ? `  ${r.error}` : ''}`);
}
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} examples ran.`);
process.exit(failed > 0 ? 1 : 0);
