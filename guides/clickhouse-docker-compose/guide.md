# ClickHouse with Docker Compose: a pinned, persistent local server with a million-row sample dataset

Run ClickHouse 25.8 in Docker Compose with a healthcheck, a password, volumes and a 1M-row sample dataset, then connect from Node, Python and hypequery.

The short version: pin the image tag, set `CLICKHOUSE_PASSWORD` (without it the `default` user cannot connect over the network), mount a volume at `/var/lib/clickhouse`, expose 8123 for HTTP clients and 9000 for `clickhouse-client`, and add a healthcheck on `/ping` so `docker compose up -d --wait` returns only when the server answers. The file below does all of that.

Everything here was run on `clickhouse/clickhouse-server:25.8` (25.8.33.6) with Docker Compose v2, and the SQL steps run in CI against the same seed dataset on every change.

## The compose file

```yaml
# docker-compose.yml
services:
  clickhouse:
    image: clickhouse/clickhouse-server:25.8
    ports:
      - "127.0.0.1:8123:8123"   # HTTP: @clickhouse/client, clickhouse-connect, hypequery, curl
      - "127.0.0.1:9000:9000"   # native TCP: clickhouse-client
    environment:
      CLICKHOUSE_USER: default
      CLICKHOUSE_PASSWORD: hypequery
      CLICKHOUSE_DB: hypequery_examples
      CLICKHOUSE_DEFAULT_ACCESS_MANAGEMENT: "1"
      TZ: UTC
    volumes:
      - clickhouse-data:/var/lib/clickhouse
      - clickhouse-logs:/var/log/clickhouse-server
    ulimits:
      nofile:
        soft: 262144
        hard: 262144
    healthcheck:
      test: ["CMD", "wget", "--no-verbose", "--tries=1", "--spider", "http://localhost:8123/ping"]
      interval: 2s
      timeout: 5s
      retries: 30
      start_period: 5s

volumes:
  clickhouse-data:
  clickhouse-logs:
```

What each part is for:

| Setting | Why |
| --- | --- |
| `image: ...:25.8` | A fixed LTS tag. `latest` moves under you, and a new major can change defaults and SQL behaviour. |
| `127.0.0.1:8123` and `127.0.0.1:9000` | 8123 is the HTTP interface every JavaScript and most Python clients use. 9000 is the native protocol for `clickhouse-client` and native drivers. The `127.0.0.1:` prefix publishes them on loopback only, so a dev box on a shared network does not expose a database with a known password. Expose only what you use, and drop the prefix only behind a firewall. |
| `CLICKHOUSE_PASSWORD` | Without `CLICKHOUSE_USER` or `CLICKHOUSE_PASSWORD`, the entrypoint disables network access for `default`; every client outside the container gets an authentication error. |
| `CLICKHOUSE_DB` | Creates the database on first start. It does not make it the default for clients: pass `database` in every connection. |
| `CLICKHOUSE_DEFAULT_ACCESS_MANAGEMENT` | Lets `default` run `CREATE USER` and `GRANT`, so you can make a read-only user for your app in SQL. |
| `volumes` | Keeps data and logs across `docker compose down` and image upgrades. Without them, removing the container removes the data. |
| `ulimits.nofile` | ClickHouse opens many files. Docker Desktop already defaults high (1,048,576 in our test); some Linux hosts do not. |
| `healthcheck` | `/ping` answers `Ok.` without credentials once the server accepts queries; `--wait` blocks on it. |

Start it and wait for healthy:

```bash
docker compose up -d --wait
curl http://localhost:8123/ping   # Ok.
```

On our machine `up -d --wait` returned in about 7 seconds with the image already pulled.

## Check the server

{{sql:sql/01-check-server.sql}}

Run SQL however you like: `curl --user default:hypequery 'http://localhost:8123/' --data-binary 'SELECT version()'`, or the bundled client inside the container, which picks up the password from the container's environment:

```bash
docker compose exec clickhouse clickhouse-client --database hypequery_examples
```

## Load the 1M-row sample dataset

hypequery's examples share one deterministic dataset: 200 tenants, 6,368 users, 1,000,000 events over twelve months (2025-11-01 to 2026-10-31) and 141 subscription periods. Its compose file is the one above without volumes, and its loader generates every row from a fixed seed and verifies checksums:

```bash
git clone https://github.com/hypequery/hypequery.git && cd hypequery
pnpm install
docker compose -f examples/_seed/docker-compose.yml up -d --wait
pnpm seed
```

`pnpm seed` drops and recreates `hypequery_examples`, so point it only at a server where that is fine. It reads `CLICKHOUSE_URL`, `CLICKHOUSE_USERNAME`, `CLICKHOUSE_PASSWORD` and `CLICKHOUSE_DATABASE`, so it also loads into the compose file above. A full load took about 10 seconds on a laptop, and the million events take about 18 MiB on disk (36 MiB uncompressed).

{{sql:sql/02-check-sample-data.sql}}

## Create your own table

The sample data is just tables in a database; add your own next to it. `ORDER BY` is the most important choice: it is the primary index, so put the columns you filter on first.

{{sql:sql/03-your-first-table.sql}}

## Give your app its own user

Use `default` for administration and give the application a user that can only read what it needs.

{{sql:sql/04-app-user.sql}}

Connected as that user, `SELECT count() FROM events` works and `CREATE TABLE` fails with `ACCESS_DENIED` (code 497). In production, keep the password out of the compose file: `env_file`, Docker secrets, or your platform's secret store.

## Storage, memory and logs

{{sql:sql/05-storage-and-logs.sql}}

ClickHouse sizes itself from the container: with a 2 GB memory limit (`deploy.resources.limits.memory: 2g` in Compose, or `docker run --memory 2g`), `max_server_memory_usage` came out at 1.80 GiB, 90% of the limit. Without a limit it uses the Docker VM's memory.

## Connect from Node, Python and hypequery

All three use the HTTP port, 8123.

Node with the official client:

```typescript
import { createClient } from '@clickhouse/client';

const client = createClient({
  url: 'http://localhost:8123',
  username: 'default',
  password: 'hypequery',
  database: 'hypequery_examples',
});
const rs = await client.query({
  query: 'SELECT event_type, count() AS events FROM events GROUP BY event_type ORDER BY events DESC LIMIT 3',
  format: 'JSONEachRow',
});
console.log(await rs.json()); // [{ event_type: 'page_view', events: 450311 }, ...]
```

Python with `clickhouse-connect`:

```python
import clickhouse_connect

client = clickhouse_connect.get_client(
    host="localhost", port=8123, username="default", password="hypequery", database="hypequery_examples"
)
print(client.query("SELECT event_type, count() AS events FROM events GROUP BY event_type ORDER BY events DESC LIMIT 3").result_rows)
# [('page_view', 450311), ('api_call', 250126), ('query_run', 149953)]
```

TypeScript with hypequery, typed from the live schema. `npx hypequery generate` reads the same `CLICKHOUSE_*` variables and writes `analytics/schema.ts`:

```bash
export CLICKHOUSE_URL=http://localhost:8123 CLICKHOUSE_USERNAME=default CLICKHOUSE_PASSWORD=hypequery CLICKHOUSE_DATABASE=hypequery_examples
npx hypequery generate
```

```typescript
import { createQueryBuilder } from '@hypequery/clickhouse';
import type { IntrospectedSchema } from './analytics/schema.js';

const db = createQueryBuilder<IntrospectedSchema>({
  url: process.env.CLICKHOUSE_URL!,
  username: process.env.CLICKHOUSE_USERNAME!,
  password: process.env.CLICKHOUSE_PASSWORD!,
  database: process.env.CLICKHOUSE_DATABASE!,
});

const rows = await db
  .table('events')
  .select(['event_type'])
  .count('event_id', 'events')
  .groupBy('event_type')
  .orderBy('events', 'DESC')
  .limit(3)
  .execute();
```

The hypequery examples and recipes default to exactly these connection settings, so once the sample dataset is loaded they run against this container with no extra configuration.

## Common errors

| Symptom | Cause and fix |
| --- | --- |
| `Code: 194 ... Authentication failed: password is incorrect, or there is no user with such name` over HTTP (status 401) | Wrong password, or no password set in compose so network access for `default` is disabled (the container log says `disabling network access for user 'default'`). Set `CLICKHOUSE_PASSWORD` and pass it from the client. Over the native port the same failure is code 516, `AUTHENTICATION_FAILED`. |
| `Port 9000 is for clickhouse-client program. You must use port 8123 for HTTP.` | An HTTP client (Node, `clickhouse-connect`, curl) pointed at 9000. Use 8123. |
| `connect ECONNREFUSED 127.0.0.1:8123` | The container is not running or not ready yet. Use `docker compose up -d --wait`, or wait on `/ping` in scripts. |
| `Bind for 0.0.0.0:8123 failed: port is already allocated` | Another ClickHouse (or anything else) holds the port. Stop it, or map a different host port: `"18123:8123"`, and use that in the client URL. |
| A new `CLICKHOUSE_DB`, user or `/docker-entrypoint-initdb.d` script has no effect | Initialisation only runs on an empty data directory. The log says `Database directory appears to contain a database; Skipping initialization`. Create it in SQL, or `docker compose down -v` to start from scratch (this deletes the data). |
| The data is gone after `docker compose down` | No volume was mounted at `/var/lib/clickhouse`. `down` keeps named volumes; `down -v` deletes them. |
| `Code: 81 ... Database hypequery_examples does not exist (UNKNOWN_DATABASE)` | The seed has not been loaded, or the client connects to a different server. `pnpm seed` creates it. |
| The container exits with code 126 and `/docker-entrypoint-initdb.d/<file>.sh: Permission denied` | Init `.sh` scripts must be executable: `chmod +x`. `.sql` files need no permission change. |

## FAQ

### Which ClickHouse Docker image should I use?

`clickhouse/clickhouse-server` with an explicit version tag, such as `25.8`. An LTS tag gets bug fixes without behaviour changes for about a year.

### How do I set the ClickHouse password in Docker?

Set `CLICKHOUSE_PASSWORD` (and optionally `CLICKHOUSE_USER`) in the service's `environment`. It is applied on the first start of an empty data volume.

### Do I need port 9000?

Only for `clickhouse-client` from the host or native-protocol drivers. Node's `@clickhouse/client`, `clickhouse-connect` and hypequery use HTTP on 8123. `docker compose exec clickhouse clickhouse-client` works without exposing 9000.

### How do I keep data between restarts?

Mount a named volume at `/var/lib/clickhouse`. `docker compose down` and `up` keep it; `down -v` removes it.

### How do I run SQL files on startup?

Mount a folder of `.sql` or executable `.sh` files at `/docker-entrypoint-initdb.d`. They run in name order, once, on the first start with an empty data directory.

## Related

- [The examples seed dataset](https://github.com/hypequery/hypequery/tree/main/examples/_seed): the compose file, schema and loader this guide uses.
- [p95 latency recipe](/recipes/p95-latency): a first typed query over the sample events.
- [Next.js dashboard example](/examples/nextjs-dashboard) and [FastAPI analytics API example](/examples/fastapi-analytics-api): full apps against the same container.
- [Refreshable materialized views](/guides/refreshable-materialized-views): the next guide to run on this setup.
