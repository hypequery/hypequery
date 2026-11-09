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
 * Each binary is run as `<binary> local`, so no server is needed. Every
 * example's output must match the one recorded in function-examples.expected.json,
 * so a changed filter, time grain or measure fails the check, not just an error.
 * Rows are compared in any order, since a GROUP BY without ORDER BY may return
 * groups in a different order on another version or server. Exit code is 1 if
 * any example errors or differs on any binary.
 *
 * After an intended change to an example, record its new output:
 *   npm run check:functions -- --update
 * and review the diff of function-examples.expected.json before committing.
 *
 * Python examples need a ClickHouse server with the fixture tables loaded and
 * a Python with hypequery and clickhouse-connect installed:
 *   npm run --silent check:functions -- --print-fixtures | clickhouse client --multiquery
 *   CHECK_PYTHON=/path/to/venv/bin/python CLICKHOUSE_URL=http://default@localhost:8123/default npm run check:functions
 * Each example runs with `python -I`, must exit 0, and must print the rows
 * recorded for it. `--update` records Python output too when CHECK_PYTHON is set.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
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

if (process.argv.includes('--print-fixtures')) {
  console.log(FIXTURES.trim());
  process.exit(0);
}

type Result = { slug: string; binary: string; version: string; ok: boolean; error?: string };
type Expected = { sql: Record<string, string>; python: Record<string, string> };

const EXPECTED_FILE = new URL('./function-examples.expected.json', import.meta.url);
const update = process.argv.includes('--update');
const expected: Expected = (() => {
  try {
    return JSON.parse(readFileSync(EXPECTED_FILE, 'utf8')) as Expected;
  } catch {
    return { sql: {}, python: {} };
  }
})();

// Values that legitimately depend on read order, rewritten before comparing.
const READ_ORDER_DEPENDENT: Record<string, (line: string) => string> = {
  // groupArray(5) keeps whichever 5 events are read first: check how many, not
  // which. Those are the event-name arrays; the page-path arrays are sorted.
  groupArray: (line) =>
    /'(view|click|buy)'/.test(line)
      ? line.replace(/\[[^\]]*\]/g, (array) => `[${array.split(',').length} items]`)
      : line,
};

/** Rows in a stable order, with read-order-dependent values rewritten. */
function normalize(slug: string, output: string): string[] {
  const rewrite = READ_ORDER_DEPENDENT[slug] ?? ((line: string) => line);
  return output.split('\n').map(rewrite).sort();
}

/** Compares an example's output with the recorded one; returns why it differs, if it does. */
function mismatch(slug: string, recorded: string | undefined, actual: string): string | undefined {
  if (recorded === undefined) return 'no recorded output; run with --update';
  const want = normalize(slug, recorded);
  const got = normalize(slug, actual);
  if (want.join('\n') === got.join('\n')) return undefined;
  const line = want.findIndex((w, i) => w !== got[i]);
  const at = line === -1 ? want.length : line;
  return `output differs at sorted row ${at + 1}: expected ${JSON.stringify(want[at] ?? '')}, got ${JSON.stringify(got[at] ?? '')}`;
}

function run(binary: string, sql: string): string {
  // One thread makes read order, and so `LIMIT` without `ORDER BY`,
  // deterministic on the single-part fixture tables.
  return execFileSync(binary, ['local', '--multiquery', '--max_threads', '1', '--query', sql], {
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
      const output = run(binary, `${FIXTURES}\n${fn.exampleSql}`).trimEnd();
      if (update && binary === binaries[0]) expected.sql[fn.slug] = output;
      const error = update ? undefined : mismatch(fn.slug, expected.sql[fn.slug], output);
      results.push({ slug: fn.slug, binary, version, ok: !error, error });
    } catch (error) {
      const stderr = (error as { stderr?: string }).stderr ?? String(error);
      results.push({ slug: fn.slug, binary, version, ok: false, error: stderr.split('\n')[0] });
    }
  }
}

for (const r of results) {
  console.log(`${r.ok ? 'ok  ' : 'FAIL'}  ClickHouse ${r.version}  ${r.slug}${r.error ? `  ${r.error}` : ''}`);
}

const python = process.env.CHECK_PYTHON;
if (python) {
  console.log('');
  for (const fn of clickhouseFunctions.filter((f) => indexedFunctionSlugs.has(f.slug) && f.pythonExample)) {
    try {
      const output = execFileSync(python, ['-I', '-'], {
        input: fn.pythonExample,
        encoding: 'utf8',
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      const printed = output.trimEnd();
      if (update) expected.python[fn.slug] = printed;
      const differs = update ? undefined : mismatch(fn.slug, expected.python[fn.slug], printed);
      results.push({ slug: fn.slug, binary: python, version: 'python', ok: !differs, error: differs });
      console.log(`${differs ? 'FAIL' : 'ok  '}  Python  ${fn.slug}${differs ? `  ${differs}` : ''}`);
    } catch (error) {
      const stderr = (error as { stderr?: string }).stderr ?? String(error);
      const lastLine = stderr.trim().split('\n').at(-1);
      results.push({ slug: fn.slug, binary: python, version: 'python', ok: false, error: lastLine });
      console.log(`FAIL  Python  ${fn.slug}  ${lastLine}`);
    }
  }
}
if (update) {
  writeFileSync(EXPECTED_FILE, `${JSON.stringify(expected, null, 2)}\n`);
  console.log(`\nRecorded outputs in ${EXPECTED_FILE.pathname}.`);
}
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} examples returned the recorded output.`);
process.exit(failed > 0 ? 1 : 0);
