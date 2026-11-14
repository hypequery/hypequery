import type { Metadata } from 'next';
import { ClickhousePillarPage } from '@/components/clickhouse-pillar-page';
import { absoluteUrl, ogImage } from '@/lib/site';

const TITLE = 'Best ClickHouse Python Client: clickhouse-connect vs driver';
const DESCRIPTION =
  'clickhouse-connect is the official ClickHouse Python client. Compare it with clickhouse-driver, clickhouse-sqlalchemy and hypequery, with safe dynamic queries.';

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: absoluteUrl('/clickhouse-python') },
  openGraph: {
    images: ogImage(TITLE),
    type: 'website',
    url: absoluteUrl('/clickhouse-python'),
    title: `${TITLE} | hypequery`,
    description: DESCRIPTION,
  },
  twitter: {
    card: 'summary_large_image',
    title: `${TITLE} | hypequery`,
    description: DESCRIPTION,
  },
};

// Every snippet below ran against ClickHouse 26.6.2 on Python 3.13 with clickhouse-connect 1.12.0,
// clickhouse-driver 0.2.11, clickhouse-sqlalchemy 0.3.2 and hypequery 0.1.0b3. Comments show what it printed.

const seedCode = `import clickhouse_connect

client = clickhouse_connect.get_client(host="localhost", port=8123)

client.command("""
    CREATE TABLE orders (
        id UInt64,
        tenant_id String,
        country LowCardinality(String),
        status LowCardinality(String),
        amount Decimal(12, 2),
        created_at DateTime
    ) ENGINE = MergeTree ORDER BY (tenant_id, created_at)
""")
client.command("""
    INSERT INTO orders VALUES
      (1, 'acme',   'US', 'completed', 120.00, '2026-10-01 09:00:00'),
      (2, 'acme',   'US', 'refunded',   40.00, '2026-10-02 10:00:00'),
      (3, 'acme',   'DE', 'completed',  75.50, '2026-10-03 11:00:00'),
      (4, 'acme',   'GB', 'completed', 210.00, '2026-10-04 12:00:00'),
      (5, 'globex', 'US', 'completed', 999.00, '2026-10-05 13:00:00'),
      (6, 'globex', 'FR', 'completed', 450.00, '2026-10-06 14:00:00')
""")`;

const connectCode = `import clickhouse_connect

client = clickhouse_connect.get_client(host="localhost", port=8123)

result = client.query(
    "SELECT country, sum(amount) AS revenue FROM orders "
    "WHERE status = {status:String} "
    "GROUP BY country ORDER BY revenue DESC",
    parameters={"status": "completed"},
)
print(result.result_rows)
# [('US', Decimal('1119.00')), ('FR', Decimal('450.00')),
#  ('GB', Decimal('210.00')), ('DE', Decimal('75.50'))]

df = client.query_df("SELECT id, country, amount FROM orders ORDER BY id LIMIT 2")
print(df)
#    id country  amount
# 0   1      US  120.00
# 1   2      US   40.00`;

const driverCode = `from clickhouse_driver import Client

client = Client(host="localhost", port=9000)

rows = client.execute(
    "SELECT country, sum(amount) AS revenue FROM orders "
    "WHERE status = %(status)s "
    "GROUP BY country ORDER BY revenue DESC",
    {"status": "completed"},
)
print(rows)
# [('US', Decimal('1119')), ('FR', Decimal('450')),
#  ('GB', Decimal('210')), ('DE', Decimal('75.5'))]

# By default the driver escapes values into the SQL text in Python:
print(client.substitute_params(
    "WHERE status = %(status)s", {"status": "it's"}, client.connection.context
))
# WHERE status = 'it\\'s'

# Or send them as server-side parameters instead:
server_side = Client(host="localhost", port=9000, settings={"server_side_params": True})
print(server_side.execute(
    "SELECT count() FROM orders WHERE status = {status:String}",
    {"status": "completed"},
))
# [(5,)]`;

const sqlalchemyCode = `from sqlalchemy import Column, MetaData, create_engine, func, select
from clickhouse_sqlalchemy import Table, engines, types

engine = create_engine("clickhouse+native://default:@localhost:9000/default")

orders = Table(
    "orders", MetaData(),
    Column("id", types.UInt64, primary_key=True),
    Column("country", types.String),
    Column("status", types.String),
    Column("amount", types.Decimal(12, 2)),
    engines.MergeTree(order_by="id"),
)

revenue = func.sum(orders.c.amount).label("revenue")
stmt = (
    select(orders.c.country, revenue)
    .where(orders.c.status == "completed")
    .group_by(orders.c.country)
    .order_by(revenue.desc())
)
with engine.connect() as conn:
    print(conn.execute(stmt).fetchall())
# [('US', Decimal('1119')), ('FR', Decimal('450')),
#  ('GB', Decimal('210')), ('DE', Decimal('75.5'))]`;

const unsafeCode = `import clickhouse_connect

client = clickhouse_connect.get_client(host="localhost", port=8123)

def orders_for(tenant_id, status):
    # UNSAFE: user input becomes part of the SQL text
    sql = (
        "SELECT id, tenant_id, amount FROM orders "
        f"WHERE tenant_id = '{tenant_id}' AND status = '{status}'"
    )
    return client.query(sql).result_rows

print(orders_for("acme", "completed"))
# [(1, 'acme', Decimal('120.00')), (3, 'acme', Decimal('75.50')),
#  (4, 'acme', Decimal('210.00'))]

print(orders_for("acme", "x' OR tenant_id != '"))
# [(1, 'acme', Decimal('120.00')), (2, 'acme', Decimal('40.00')),
#  (3, 'acme', Decimal('75.50')), (4, 'acme', Decimal('210.00')),
#  (5, 'globex', Decimal('999.00')), (6, 'globex', Decimal('450.00'))]`;

const safeCode = `import clickhouse_connect

client = clickhouse_connect.get_client(host="localhost", port=8123)

# Identifiers and keywords can't be parameters: map input to fixed SQL.
SORT_COLUMNS = {"created_at": "created_at", "amount": "amount"}
SORT_DIRECTIONS = {"asc": "ASC", "desc": "DESC"}

def search_orders(tenant_id, status=None, countries=None, min_amount=None,
                  sort="created_at", direction="desc", limit=50):
    where = ["tenant_id = {tenant_id:String}"]
    params = {"tenant_id": tenant_id, "limit": limit}

    if status is not None:
        where.append("status = {status:String}")
        params["status"] = status
    if countries:
        where.append("country IN {countries:Array(String)}")
        params["countries"] = list(countries)
    if min_amount is not None:
        where.append("amount >= {min_amount:Decimal(12, 2)}")
        params["min_amount"] = min_amount

    if sort not in SORT_COLUMNS or direction not in SORT_DIRECTIONS:
        raise ValueError(f"unsupported sort: {sort!r} {direction!r}")

    sql = " ".join([
        "SELECT id, country, status, amount FROM orders",
        "WHERE " + " AND ".join(where),
        f"ORDER BY {SORT_COLUMNS[sort]} {SORT_DIRECTIONS[direction]}",
        "LIMIT {limit:UInt32}",
    ])
    return client.query(sql, parameters=params).result_rows

print(search_orders("acme", status="completed", countries=["US", "GB"], sort="amount"))
# [(4, 'GB', 'completed', Decimal('210.00')), (1, 'US', 'completed', Decimal('120.00'))]

print(search_orders("acme", status="x' OR tenant_id != '"))
# []

print(search_orders("acme", min_amount=100))
# [(4, 'GB', 'completed', Decimal('210.00')), (1, 'US', 'completed', Decimal('120.00'))]

try:
    search_orders("acme", sort="amount; DROP TABLE orders")
except ValueError as exc:
    print(exc)
# unsupported sort: 'amount; DROP TABLE orders' 'desc'`;

const hypequeryFiltersCode = `from hypequery.datasets import (
    Dataset, DatasetQuery, ExecutionContext, create_dataset_client,
    dimension, filter, measure, order, tenant,
)
from hypequery.execution import ClickHouseConnection, create_clickhouse_executor

orders = Dataset(
    name="orders",
    source="orders",
    tenant_key="tenant_id",
    time_key="created_at",
    dimensions={
        "country": dimension.string(),
        "status": dimension.string(),
        "created_at": dimension.timestamp(),
    },
    measures={
        "revenue": measure.sum("amount"),
        "order_count": measure.count("id"),
    },
)

executor = create_clickhouse_executor(ClickHouseConnection(host="localhost", port=8123))
analytics = create_dataset_client(executor=executor)

def revenue_by_country(tenant_id, status=None, countries=None):
    filters = []
    if status is not None:
        filters.append(filter.eq("status", status))
    if countries:
        filters.append(filter.in_list("country", list(countries)))
    query = DatasetQuery(
        dimensions=("country",),
        measures=("revenue", "order_count"),
        filters=tuple(filters),
        order_by=(order.desc("revenue"),),
    )
    context = ExecutionContext(tenant=tenant(tenant_id))
    return analytics.execute(orders, query, context=context)

print(revenue_by_country("acme", status="completed", countries=["US", "GB"]).data)
# ({'country': 'GB', 'revenue': '210.00', 'order_count': 1},
#  {'country': 'US', 'revenue': '120.00', 'order_count': 1})

print(revenue_by_country("acme", status="x' OR tenant_id != '").data)
# ()`;

const hypequeryValidateCode = `context = ExecutionContext(tenant=tenant("acme"))

checks = {
    "undeclared filter": DatasetQuery(
        measures=("revenue",), filters=(filter.gt("amount", 100),)),
    "tenant filter": DatasetQuery(
        measures=("revenue",), filters=(filter.eq("tenant_id", "globex"),)),
    "undeclared sort": DatasetQuery(
        dimensions=("country",), measures=("revenue",), order_by=(order.desc("amount"),)),
}
for name, query in checks.items():
    result = analytics.validate(orders, query, context=context)
    print(name, result.valid, result.errors)
# undeclared filter False ('Unknown dimension "amount" on dataset "orders". Available: country, created_at, status',)
# tenant filter False ('Cannot filter on tenant field "tenant_id" while runtime tenant scoping is active.',)
# undeclared sort False ('Cannot order by "amount" because it is not selected. Available: country, revenue',)

try:
    order.desc("revenue; DROP TABLE orders")
except Exception as exc:
    print(type(exc).__name__, exc)
# ProtocolIdentifierError HQ_IDENTIFIER_INVALID_FORMAT

print(analytics.to_sql(orders, DatasetQuery(
    dimensions=("country",), measures=("revenue",),
    filters=(filter.in_list("country", ["US", "GB"]),),
), context=context))
# SELECT \`__hq_base\`.\`country\` AS \`country\`, sum(\`__hq_base\`.\`amount\`) AS \`revenue\`
# FROM \`orders\` AS \`__hq_base\` WHERE \`__hq_base\`.\`country\` IN <p0:Array(String)>
# AND \`__hq_base\`.\`tenant_id\` = <p1:String> GROUP BY \`country\``;

const hypequeryWireCode = `import http.client

# Print the HTTP requests hypequery's executor sends (debug only).
http.client.HTTPConnection.debuglevel = 1
revenue_by_country("acme", status="x' OR tenant_id != '")
# send: b'POST /?...&param_p0=x%5C%27+OR+tenant_id+%21%3D+%5C%27&param_p1=acme HTTP/1.1
#   User-Agent: clickhouse-connect/1.12.0 (lv:py/3.13.1; mode:sync; ...)'
# send: b'SELECT \`__hq_base\`.\`country\` AS \`country\`, sum(\`__hq_base\`.\`amount\`) AS \`revenue\`,
#   count(\`__hq_base\`.\`id\`) AS \`order_count\` FROM \`orders\` AS \`__hq_base\`
#   WHERE \`__hq_base\`.\`status\` = {p0:String} AND \`__hq_base\`.\`tenant_id\` = {p1:String}
#   GROUP BY \`country\` ORDER BY \`revenue\` DESC\\n FORMAT Native'`;

export default function ClickHousePythonPage() {
  return (
    <ClickhousePillarPage
      leadPage="/clickhouse-python"
      eyebrow="ClickHouse Python clients"
      title="ClickHouse Python clients compared: clickhouse-connect, clickhouse-driver, SQLAlchemy and hypequery"
      description="For most Python code, use clickhouse-connect: it is the client ClickHouse maintains, it talks to the HTTP interface, binds `{name:Type}` parameters on the server, and returns pandas, NumPy or Arrow. clickhouse-driver is the community client for the native TCP protocol, clickhouse-sqlalchemy is a SQLAlchemy dialect built on it, and hypequery runs on top of clickhouse-connect to add named, validated, tenant-scoped analytics queries."
      primaryCta={{ href: '/docs/python/quick-start', label: 'Start with Python' }}
      secondaryCta={{ href: '/clickhouse-fastapi', label: 'See the FastAPI guide' }}
      language="python"
      stats={[
        { label: 'Official client', value: 'clickhouse-connect 1.12.0' },
        { label: 'Native TCP client', value: 'clickhouse-driver 0.2.11' },
        { label: 'Examples checked on', value: 'ClickHouse 26.6, Python 3.13' },
      ]}
      comparisonMatrix={{
        eyebrow: 'Comparison',
        title: 'clickhouse-connect vs clickhouse-driver vs clickhouse-sqlalchemy vs hypequery',
        description:
          'The first three are ways to send SQL to ClickHouse. hypequery is a layer above clickhouse-connect: you declare measures and dimensions, and it writes the SQL.',
        columns: [
          { label: 'clickhouse-connect' },
          { label: 'clickhouse-driver' },
          { label: 'clickhouse-sqlalchemy' },
          { label: 'hypequery', highlight: true },
        ],
        rows: [
          {
            label: 'Maintained by',
            cells: [
              'ClickHouse, in the `ClickHouse/clickhouse-connect` GitHub repository',
              'Community, `mymarilyn/clickhouse-driver`',
              'Community, `xzkostyan/clickhouse-sqlalchemy`',
              'hypequery, Apache-2.0',
            ],
          },
          {
            label: 'Protocol',
            cells: [
              'HTTP interface, port 8123 by default',
              'Native TCP protocol, port 9000 by default',
              'Native through clickhouse-driver (the interface its README recommends), HTTP, or async native through asynch',
              'HTTP, through clickhouse-connect',
            ],
          },
          {
            label: 'Latest release on PyPI',
            cells: ['1.12.0, 3 Nov 2026', '0.2.11, 17 Jul 2026', '0.3.2, 12 Jun 2024', '0.1.0b3, 5 Nov 2026 (beta)'],
          },
          {
            label: 'Python',
            cells: ['3.10 to 3.15', '3.9 and later', '3.7 and later, with SQLAlchemy 2.0.x', '3.11 and later'],
          },
          {
            label: 'Query parameters',
            cells: [
              'Server-side `{name:Type}` placeholders, or client-side `%(name)s` formatting',
              'Client-side `%(name)s` escaping by default; server-side `{name:Type}` with `server_side_params=True`',
              'SQLAlchemy bound parameters from expressions or `text()`',
              'Generated: every value is sent as a server-side parameter',
            ],
          },
          {
            label: 'DataFrames and Arrow',
            cells: [
              '`query_df`, `query_np`, `query_arrow`, `insert_df`; Polars through `query_df_arrow`',
              '`query_dataframe` with the `use_numpy` setting and the `numpy` extra',
              'Rows through SQLAlchemy result objects',
              '`to_pandas()`, `to_polars()`, `to_arrow()`, typed from the dataset',
            ],
          },
          {
            label: 'asyncio',
            cells: [
              '`get_async_client`, with `clickhouse-connect[async]`',
              'No async API; asynch is a separate async native client',
              '`clickhouse+asynch://` through asynch',
              '`create_async_dataset_client`',
            ],
          },
          {
            label: 'SQLAlchemy',
            cells: [
              'Its own `clickhousedb://` dialect: Core, reflection and basic ORM reads',
              'Used by clickhouse-sqlalchemy as its native transport',
              'The dialect itself: Core, ORM sessions and ClickHouse table engines',
              '`executor_from_engine` reuses an HTTP engine URL',
            ],
          },
          {
            label: 'Use it for',
            cells: [
              'New code, notebooks, inserts, Superset',
              'Code already written against it, or networks that only open the native port',
              'Apps whose models already live in SQLAlchemy',
              'Metrics that more than one service, API or agent reads',
            ],
          },
        ],
        footnote:
          'Releases and Python ranges from PyPI on 8 November 2026. Every example on this page ran against ClickHouse 26.6.2 on Python 3.13 with the versions above.',
      }}
      problemsHeading={{
        eyebrow: 'The clients',
        title: 'Which ClickHouse Python client should you use?',
        description:
          'All of these talk to the same server. The choice depends on which protocol you can reach and which API your code already uses.',
      }}
      problems={[
        {
          title: 'clickhouse-connect',
          copy:
            'The client ClickHouse maintains, and the one its Python docs describe. It uses the HTTP interface and binds `{name:Type}` parameters on the server. `query_df`, `query_np` and `query_arrow` return pandas, NumPy and Arrow, and `insert_df` writes a DataFrame. Start here for new code.',
        },
        {
          title: 'clickhouse-driver',
          copy:
            'A community client for the native TCP protocol, still released (0.2.11 in July 2026). It escapes `%(name)s` values into the SQL in Python by default, and binds them on the server with `server_side_params=True`. Choose it when existing code depends on it or only the native port is reachable.',
        },
        {
          title: 'clickhouse-sqlalchemy',
          copy:
            'A SQLAlchemy 2.0 dialect with Core, ORM sessions and ClickHouse engines such as `engines.MergeTree`. Its README recommends the native transport through clickhouse-driver, with HTTP and asynch as alternatives. The last release, 0.3.2, is from June 2024. Choose it when your models already live in SQLAlchemy.',
        },
        {
          title: "clickhouse-connect's SQLAlchemy dialect",
          copy:
            'clickhouse-connect registers its own `clickhousedb://` dialect over HTTP. ClickHouse documents it as supporting Core, reflection and Alembic, with basic ORM reads and inserts, and recommends it for Apache Superset.',
        },
        {
          title: 'chDB',
          copy:
            'chDB runs the ClickHouse engine inside your Python process, with no server to install. It reads Parquet, CSV, JSON and Arrow files and works with pandas, which suits notebooks and tests. clickhouse-connect can also use it through an experimental `interface="chdb"` backend.',
        },
        {
          title: 'hypequery',
          copy:
            'A semantic layer that runs on clickhouse-connect. You declare a table\'s dimensions and measures once, callers ask for them by name, and hypequery writes parameterized SQL, checks every filter against the declared fields and adds the tenant predicate. Use it next to a client, for the queries other code depends on.',
        },
      ]}
      solutionSection={{
        eyebrow: 'Basics',
        title: 'The same query in clickhouse-connect, clickhouse-driver and SQLAlchemy',
        description:
          'Each panel computes revenue per country for completed orders on the six-row `orders` table created in the first panel. The comments show what each one printed, wrapped to fit.',
        paragraphs: [
          'All three return the same rows. The `Decimal(12, 2)` sums differ in form: clickhouse-connect returned `Decimal(\'1119.00\')` with the column\'s scale, while clickhouse-driver, and clickhouse-sqlalchemy on top of it, returned `Decimal(\'1119\')`.',
          'clickhouse-sqlalchemy\'s ORM works too: `session.query(...)` on a declarative model from `get_declarative_base()` ran the same aggregation through `make_session(engine)`.',
        ],
        codePanels: [
          {
            eyebrow: 'Test data',
            title: 'A small multi-tenant `orders` table',
            description: 'Two tenants, `acme` and `globex`, so the injection test later can show one reading the other\'s rows.',
            code: seedCode,
            filename: 'seed.py',
            language: 'python',
          },
          {
            eyebrow: 'clickhouse-connect',
            title: 'HTTP, server-side parameters, a DataFrame',
            description: '`parameters=` with a `{status:String}` placeholder sends the value separately from the SQL. `query_df` returns a pandas DataFrame.',
            code: connectCode,
            filename: 'connect_example.py',
            language: 'python',
          },
          {
            eyebrow: 'clickhouse-driver',
            title: 'Native TCP, client-side or server-side parameters',
            description: 'By default the driver escapes the value into the SQL text. With `server_side_params=True` it sends `{name:Type}` placeholders for the server to bind.',
            code: driverCode,
            filename: 'driver_example.py',
            language: 'python',
          },
          {
            eyebrow: 'clickhouse-sqlalchemy',
            title: 'SQLAlchemy Core over the native protocol',
            description: '`clickhouse+native://` uses clickhouse-driver underneath; `clickhouse+http://` uses HTTP instead.',
            code: sqlalchemyCode,
            filename: 'sqlalchemy_example.py',
            language: 'python',
          },
        ],
      }}
      implementationSection={{
        eyebrow: 'Dynamic queries',
        title: 'Safely composing dynamic queries and filters in Python',
        description:
          'Never paste user input into the SQL text with f-strings, `+` or `%`. Send each value as a server-side parameter (`{name:Type}` placeholders with `parameters=` in clickhouse-connect), add a clause only when its filter is present, and map anything that can\'t be a parameter, such as a sort column or `ASC`/`DESC`, through a dict of fixed SQL.',
        paragraphs: [
          'The first panel builds the `WHERE` clause with an f-string. Passing `x\' OR tenant_id != \'` as the status produces `tenant_id = \'acme\' AND status = \'x\' OR tenant_id != \'\'`. `AND` binds tighter than `OR`, so every row matches and the call returns all six orders, including the two that belong to `globex`.',
          'The second panel appends a clause and a parameter only for the filters the caller sent. An `IN` list binds as one `Array(String)` parameter and the amount as `Decimal(12, 2)`. The same payload now returns `[]`, because ClickHouse compares the whole string to `status`. On the wire, clickhouse-connect sent the SQL with `{status:String}` in the request body and the value as a separate `param_status` URL parameter.',
          'Parameters hold values only. ClickHouse also has an `Identifier` parameter type for names (`ORDER BY {col:Identifier}`); it quotes the name, so `amount; DROP TABLE orders` failed with `UNKNOWN_IDENTIFIER` in our test. It still lets a caller sort by any column, and `ASC`/`DESC` can\'t be bound at all, so an allow-list is the simpler rule.',
          'clickhouse-connect\'s client-side `%(name)s` binding and clickhouse-driver\'s default binding both escaped the same payload and returned 0 rows. What breaks is building the SQL string yourself. Server-side binding also keeps the value out of the query text, where it can\'t change how the query parses.',
        ],
        codePanels: [
          {
            eyebrow: 'Unsafe',
            title: 'An f-string WHERE clause that leaks another tenant\'s rows',
            description: 'Run against a local test server. The second call returns `globex` orders to an `acme` caller.',
            code: unsafeCode,
            filename: 'unsafe_filters.py',
            language: 'python',
          },
          {
            eyebrow: 'Safe with clickhouse-connect',
            title: 'Optional filters, an IN list and an allow-listed sort',
            description: 'Only fixed strings from this file reach the SQL text. Every value from the caller travels as a typed parameter.',
            code: safeCode,
            filename: 'search_orders.py',
            language: 'python',
          },
        ],
      }}
      additionalSections={[
        {
          eyebrow: 'Dynamic queries with hypequery',
          title: 'The same filters with hypequery, validated against declared dimensions',
          description:
            'With hypequery you pass filters as data (`filter.eq`, `filter.in_list`) against a dataset. Any field the dataset doesn\'t declare is rejected before a query runs, and the tenant comes from the execution context, so no filter can change it.',
          paragraphs: [
            'The injection payload returned `()`: hypequery sent it as `{p0:String}` and the tenant as `{p1:String}`, both server-side parameters.',
            '`validate` checks a query without running it. Filtering on `amount`, which isn\'t a declared dimension, filtering on the tenant column, and sorting by a field the query doesn\'t select each came back invalid with the messages shown. A malformed field name fails earlier, when `order.desc` builds the value.',
            '`to_sql` prints a redacted statement with `<p0:Array(String)>` where the values go. It is for debugging and can\'t be executed.',
          ],
          codePanels: [
            {
              eyebrow: 'hypequery',
              title: 'A dataset and optional filters',
              description: 'Revenue comes back as a string to keep `Decimal` precision; `to_pandas()` turns it into a number column.',
              code: hypequeryFiltersCode,
              filename: 'revenue_by_country.py',
              language: 'python',
            },
            {
              eyebrow: 'Validation',
              title: 'Undeclared fields and tenant filters are rejected',
              description: 'Continues the previous panel. `validate` and `to_sql` plan the query in Python and sent no request to ClickHouse.',
              code: hypequeryValidateCode,
              filename: 'validate_queries.py',
              language: 'python',
            },
          ],
        },
        {
          eyebrow: 'hypequery on top',
          title: 'How hypequery uses clickhouse-connect',
          description:
            'hypequery for Python runs its ClickHouse queries through clickhouse-connect. The `hypequery[clickhouse]` extra installs clickhouse-connect 1.4.2 or newer, and the executor opens one clickhouse-connect client for queries and a second for cancelling them with `KILL QUERY`.',
          paragraphs: [
            'Plain `pip install hypequery` installs only pydantic, tzdata, anyio and idna, so dataset definitions import without a database driver. Install `hypequery[clickhouse]`, or `hypequery[clickhouse-async]` for asyncio, to execute queries.',
            'The capture in the panel shows the request: the user agent is `clickhouse-connect/1.12.0`, the body holds the generated SQL with `{p0:String}` and `{p1:String}`, and the values travel as `param_p0` and `param_p1`.',
            'Keep calling clickhouse-connect directly for inserts, DDL and one-off SQL. Use hypequery for the measures several services read, so they share one definition and one tenant rule.',
            'An existing SQLAlchemy engine works too: `executor_from_engine(engine)` accepted `clickhousedb://` and `clickhouse+http://` engines and refused `clickhouse+native://`, because server-side parameters need the HTTP interface.',
          ],
          codePanel: {
            eyebrow: 'On the wire',
            title: 'What hypequery sends through clickhouse-connect',
            description: 'Continues the hypequery panel above. Output trimmed to the request line, user agent and body.',
            code: hypequeryWireCode,
            filename: 'show_request.py',
            language: 'python',
          },
        },
      ]}
      searchIntentCards={[
        {
          title: 'Should I use clickhouse-connect or clickhouse-driver?',
          copy:
            'clickhouse-connect is maintained by ClickHouse and uses the HTTP interface; clickhouse-driver is a community client for the native TCP protocol. Both returned the same rows in our tests and both escaped the injection payload. Pick clickhouse-connect for new code, for its `{name:Type}` server-side binding and its pandas, NumPy and Arrow methods. Keep clickhouse-driver where code or network rules already depend on the native protocol.',
        },
        {
          title: 'What is the best Python client for ClickHouse?',
          copy:
            'clickhouse-connect, for most projects: ClickHouse maintains it, its docs use it, and it shipped 1.12.0 on 3 November 2026. Use clickhouse-sqlalchemy if your app is built on SQLAlchemy, chDB to run ClickHouse in-process without a server, and add hypequery when several parts of your product query the same metrics.',
        },
        {
          title: 'Does ClickHouse work with SQLAlchemy?',
          copy:
            'Yes, through two dialects. clickhouse-sqlalchemy (`clickhouse+native://`, `clickhouse+http://`, `clickhouse+asynch://`) supports Core and ORM sessions and needs SQLAlchemy 2.0.x; its last release was 0.3.2 in June 2024. clickhouse-connect ships `clickhousedb://`, aimed at Core and Superset. Both ran a `text()` query with a bound parameter in our tests.',
        },
        {
          title: 'How do I build a ClickHouse WHERE clause from user input in Python?',
          copy:
            'Keep a list of clauses and a dict of parameters. For each filter the user sent, append a clause such as `"status = {status:String}"` and set `params["status"]`. Join the clauses with `AND`, map sort columns and directions through a dict of fixed SQL, and pass `parameters=params` to `client.query`.',
        },
        {
          title: 'Is clickhouse-driver still maintained?',
          copy:
            'Yes, as of November 2026: 0.2.11 reached PyPI on 17 July 2026 and the GitHub repository is not archived. It is a community project, separate from ClickHouse\'s own clickhouse-connect.',
        },
        {
          title: 'How do I get ClickHouse results into pandas?',
          copy:
            'With clickhouse-connect, `client.query_df(sql)` returns a DataFrame and `client.insert_df(table, df)` writes one. clickhouse-driver has `query_dataframe` when `use_numpy` is on. hypequery results have `to_pandas()`, which types columns from the dataset definition.',
        },
      ]}
      sources={[
        { href: 'https://clickhouse.com/docs/integrations/python', label: 'ClickHouse docs: Python integration with ClickHouse Connect' },
        {
          href: 'https://clickhouse.com/docs/integrations/language-clients/python/driver-api#parameters-argument',
          label: 'ClickHouse docs: ClickHouse Connect server-side and client-side binding',
        },
        {
          href: 'https://clickhouse.com/docs/sql-reference/syntax#defining-and-using-query-parameters',
          label: 'ClickHouse docs: defining and using query parameters',
        },
        { href: 'https://clickhouse.com/docs/chdb', label: 'ClickHouse docs: chDB' },
        { href: 'https://github.com/ClickHouse/clickhouse-connect', label: 'clickhouse-connect on GitHub' },
        { href: 'https://clickhouse-driver.readthedocs.io', label: 'clickhouse-driver documentation' },
        { href: 'https://github.com/xzkostyan/clickhouse-sqlalchemy', label: 'clickhouse-sqlalchemy on GitHub' },
      ]}
      readingLinks={[
        {
          href: '/blog/chdb-python-tutorial',
          title: 'chDB Python tutorial',
          description: 'Run ClickHouse SQL inside a Python process, with no server.',
        },
        {
          href: '/docs/python',
          title: 'hypequery Python docs',
          description: 'Datasets, filters, execution and serving on top of clickhouse-connect.',
        },
        {
          href: '/clickhouse-fastapi',
          title: 'ClickHouse FastAPI',
          description: 'Serve Python datasets as authenticated, tenant-scoped HTTP endpoints.',
        },
        {
          href: '/clickhouse-django',
          title: 'ClickHouse with Django',
          description: 'Query ClickHouse from a Django app next to your existing database.',
        },
        {
          href: '/fastapi-react-analytics',
          title: 'FastAPI and React analytics',
          description: 'Typed React hooks on the endpoints your Python app serves.',
        },
        {
          href: '/python-semantic-layer',
          title: 'Python semantic layer',
          description: 'Why define analytics as Python code instead of YAML or a separate server.',
        },
      ]}
      relatedPillars={[
        { href: '/compare/hypequery-vs-clickhouse-connect', label: 'hypequery vs clickhouse-connect' },
        { href: '/clickhouse-sqlalchemy', label: 'ClickHouse with SQLAlchemy' },
        { href: '/clickhouse-pandas', label: 'ClickHouse to pandas' },
        { href: '/clickhouse-python-analytics', label: 'ClickHouse analytics in Python' },
        { href: '/clickhouse-fastapi', label: 'ClickHouse FastAPI' },
        { href: '/clickhouse-django', label: 'ClickHouse with Django' },
        { href: '/clickhouse-flask', label: 'ClickHouse with Flask' },
      ]}
      nextStep={{
        eyebrow: 'Next step',
        title: 'Keep your client and model one table',
        description:
          'Pick the ClickHouse query your services copy most often, define it as a dataset, and run it through the same clickhouse-connect connection settings you use today.',
        primaryCta: { href: '/docs/python/quick-start', label: 'Start with Python' },
        secondaryCta: { href: '/docs/python', label: 'Read the Python docs' },
      }}
    />
  );
}
