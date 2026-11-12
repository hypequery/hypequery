# ClickHouse async inserts from Node.js: per-row vs batch vs async_insert

Insert the same 1,000 rows from Node per row, in client batches and with async_insert, and count the parts each creates: 1,000, 4, 10 and 1.

Every synchronous `INSERT` into a MergeTree table writes at least one new part, so 1,000 single-row inserts make 1,000 parts. Batch in the client when you can (1,000 rows in batches of 250 made 4 parts); when many small writers cannot batch, set `async_insert = 1` and the server buffers their rows and writes one part per flush (10 parts here, with 100 inserts in flight and a 500 ms flush; the exact count depends on how many inserts land in each flush window, so the test only bounds it). Keep `wait_for_async_insert = 1`, the default, so each insert returns only after its row is written and errors reach the caller; with `0` the calls returned while the table was still empty. The recipe uses hypequery's typed `db.insert()`, which sends JSONEachRow through the official `@clickhouse/client`.

## Demo

```text
1000 rows into a MergeTree table, four ways (merges stopped, so parts = parts created)

strategy                               inserts  parts  rows  rows when calls returned   time
per-row INSERT                            1000   1000  1000                      1000   7.5-8.7 s
client batches of 250                        4      4  1000                      1000   41-48 ms
async_insert, wait=1, 100 in flight       1000     10  1000                      1000   5.4 s
async_insert, wait=0, then flush          1000      1  1000                         0   3.6-4.6 s
```

Parts and rows are pinned in `output.json`; times are from a laptop (8 cores, ClickHouse in Docker) and are not pinned. The async rows above use a fixed 500 ms flush so the part count is reproducible; with the default adaptive timeout, one run of the same 1,000 rows took 2.2 s and made 13 parts.

## Install

```bash
npx @hypequery/cli create async-inserts-node -y
cd async-inserts-node
docker compose -f ../examples/_seed/docker-compose.yml up -d --wait && pnpm seed   # or set CLICKHOUSE_* for your own ClickHouse
pnpm install
pnpm dev
```

`pnpm dev` creates `async_inserts_node_events`, stops background merges on it so every new part stays visible, runs the four strategies, prints the table and drops the table. It needs a user that may `CREATE`, `INSERT` and run `SYSTEM STOP MERGES` / `SYSTEM FLUSH ASYNC INSERT QUEUE`.

## What it shows

- **Typed inserts** (`src/ingest.ts`): `db.insert('async_inserts_node_events').values(rows)` checks row shapes against the table type; `.settings({ async_insert: 1, ... })` turns on server-side batching per call.
- **Parts created, measured** (`src/table.ts`): active parts and rows from `system.parts`, with merges stopped so nothing hides the count.
- **What is actually sent** (`expected.sql`): the test reads the statement back from `system.query_log`. It is `INSERT INTO async_inserts_node_events FORMAT JSONEachRow`; the rows go in the request body and `async_insert` travels as a setting.
- **Fire and forget, visibly** (`src/smoke.test.ts`): with `wait_for_async_insert = 0` all 1,000 calls returned while the table had 0 rows; the rows appeared only at the flush.

## Key file

```ts
// 2. Buffer in the app and send one INSERT per batch: one part per batch.
for (let i = 0; i < rows.length; i += batchSize) {
  await db.insert('async_inserts_node_events').values(rows.slice(i, i + batchSize)).execute();
}

// 3. Many small writers: let the server batch. Each call resolves once its row is in a part.
await Promise.all(rows.map((row) =>
  db.insert('async_inserts_node_events').values(row)
    .settings({ async_insert: 1, wait_for_async_insert: 1 })
    .execute(),
));
```

## Which one to use

- **You control the writer and can buffer**: batch in the client. Fewest parts, fastest, and errors come back on the call that sent the batch. Bigger batches mean fewer parts and less merge work.
- **Many processes, each sending a few rows** (serverless functions, webhooks, per-request logging): `async_insert = 1` with `wait_for_async_insert = 1`. Batching comes from concurrency: rows that arrive within one flush window share a part. Sent one at a time and awaited, async inserts batch nothing: 50 sequential awaited inserts made 50 parts and took 5.5 s (about 110 ms each, the flush wait), slower than plain inserts.
- **`wait_for_async_insert = 0`** only when losing rows on a crash is acceptable. The call returns once the row is queued; parse errors and server restarts are never reported back.

## Surprises worth knowing

- **Too many parts throttles, then fails.** The per-row run ends at exactly 1,000 parts in one partition, the default `parts_to_delay_insert`; the next insert was delayed (`DelayedInserts = 1` in `system.query_log`), and at `parts_to_throw_insert` (3,000) inserts fail. Background merges normally keep you below that, but a per-row ingest loop can outrun them.
- **`written_rows` is 0 for async inserts.** The summary hypequery returns from `execute()` reports `written_rows: '0'` even with `wait_for_async_insert = 1`, because the flush writes the rows, not the INSERT. Check `system.asynchronous_insert_log` (one row per insert, with its `flush_query_id`) instead.
- **`async_insert_max_query_number` did not flush.** It is 450 by default, yet 1,000 queued inserts with a 60 s timeout stayed in the buffer until `SYSTEM FLUSH ASYNC INSERT QUEUE`. Flushes here came from the busy timeout or the manual flush; buffer size (`async_insert_max_data_size`, 10 MiB) is the other trigger.
- **The connection pool caps concurrency.** Each awaited async insert holds an HTTP connection until its flush, and `@clickhouse/client` opens 10 by default; `src/client.ts` sets `max_open_connections: 100` to keep 100 in flight.
- **A readonly API user cannot insert.** Give ingest its own user with its own settings profile. See [ClickHouse settings for application backends](https://hypequery.com/blog/clickhouse-settings-for-application-backends).

## Architecture

```text
src/ingest.ts ── db.insert(table).values(rows).settings({...}).execute()
                     │  hypequery InsertBuilder → @clickhouse/client.insert(JSONEachRow)
                     ▼
ClickHouse   sync:  one part per INSERT
             async: server-side buffer (per query and settings) ── flush on timeout / size ──▶ one part per flush
                     │
src/table.ts ── system.parts (merges stopped) ──▶ output.json (parts and rows, asserted in CI)
```

## Adapt it

- **Your table.** Add it to `src/schema.ts` (or generate it with `npx hypequery generate`), and `db.insert()` type-checks your rows against it.
- **Production settings.** Drop `async_insert_use_adaptive_busy_timeout: 0` and the 500 ms timeout; the adaptive default (50 to 200 ms) is tuned for latency. Do not stop merges: the recipe does that only to make every part countable.
- **Set it once.** Put `async_insert: 1` in the ingest user's settings profile instead of on every call, so a forgotten `.settings()` cannot fall back to one part per row.
- **Deduplication.** On replicated tables, retried async inserts are deduplicated only with `async_insert_deduplicate = 1`.

## Related recipes

- [cursor-pagination](../cursor-pagination): reading the same kind of event table back, page by page.

## Related examples

- [materialized-view-rollups](../../examples/materialized-view-rollups): roll up rows as they land.

Tested on ClickHouse 25.8 with `@hypequery/clickhouse` 2.14.
