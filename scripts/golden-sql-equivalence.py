"""Execute the datasets golden SQL corpus from two git revisions and compare results.

Use it to review an intentional golden diff: every statement whose text changed
between BASE and HEAD runs in `clickhouse local` against the same generated
tables (NULL times, a status containing a quote and a backslash, two tenants),
and its column names and rows must match. Rows compare as a multiset, since
not every statement fully orders its result, and `clickhouse local` runs with
one thread so a LIMIT over ties picks the same rows on both sides. Statements
whose text did not change are skipped; added statements and files must run
without error.

Requires the `clickhouse` binary on PATH (`clickhouse local` needs no server).

    python3 scripts/golden-sql-equivalence.py . origin/main HEAD < /dev/null

Exit status is 1 when any changed statement returns a different result, or
when any changed or added statement fails to run.
"""
import json, subprocess, sys, re

REPO, BASE, HEAD = sys.argv[1], sys.argv[2], sys.argv[3]
GOLDEN = 'packages/datasets/src/tests/golden-sql'
SETUP = r"""
CREATE DATABASE analytics;
CREATE TABLE analytics.orders (tenant_id String, created_at Nullable(DateTime), customer_id Nullable(UInt32), status String, region_code String, is_gift UInt8, amount_cents Float64) ENGINE = Memory;
CREATE TABLE analytics.customers (tenant_id String, customer_id UInt32, country_code String, tier String) ENGINE = Memory;
INSERT INTO analytics.customers VALUES ('acme',1,'US','gold'),('acme',2,'DE','silver'),('acme',3,'US','gold'),('globex',1,'FR','gold');
INSERT INTO analytics.orders SELECT
  if(number % 7 = 0, 'globex', 'acme'),
  if(number % 13 = 0, NULL, toDateTime('2025-12-20 00:00:00', 'UTC') + number * 7919),
  if(number % 11 = 0, NULL, number % 4),
  ['paid','shipped','paid''s \\ quote','refunded'][number % 4 + 1],
  ['eu','us','apac'][number % 3 + 1],
  number % 5 = 0,
  (number * 37) % 1000 / 10
FROM numbers(1500);
"""

def literal(v):
    if v is None: return 'NULL'
    if isinstance(v, bool): return 'true' if v else 'false'
    if isinstance(v, (int, float)): return repr(v)
    return "'" + str(v).replace('\\', '\\\\').replace("'", "''") + "'"

def substitute(sql, params):
    # Splits on ? outside quotes, mirroring the ClickHouse adapter.
    out, i, p, q = [], 0, 0, None
    while i < len(sql):
        c = sql[i]
        if q:
            out.append(c)
            if c == '\\': out.append(sql[i+1]); i += 2; continue
            if c == q:
                if i + 1 < len(sql) and sql[i+1] == q: out.append(q); i += 2; continue
                q = None
        elif c in "'`\"": q = c; out.append(c)
        elif c == '?': out.append(literal(params[p])); p += 1
        else: out.append(c)
        i += 1
    assert p == len(params), (p, len(params))
    return ''.join(out)

def statements(rev, name):
    text = subprocess.check_output(['git', '-C', REPO, 'show', f'{rev}:{GOLDEN}/{name}']).decode()
    sections = {}
    for block in re.split(r'\n\n(?=-- )', text.rstrip('\n')):
        head, _, body = block.partition('\n')
        sections[head[3:]] = body
    sql = sections['sql']
    # Metric files record toSQL() only: their one bound value is the tenant.
    params = json.loads(sections['parameters']) if 'parameters' in sections else ['acme'] * sql.count('?')
    out = [('sql', sql, params)]
    i = 0
    while f'preflight {i}' in sections:
        out.append((f'preflight {i}', sections[f'preflight {i}'], json.loads(sections[f'preflight {i} parameters']))); i += 1
    return out

def run(sql):
    try:
        r = subprocess.run(['clickhouse', 'local', '--max_threads', '1', '--multiquery', '--query', SETUP + sql + ' FORMAT TSVWithNames'],
                           capture_output=True, text=True, stdin=subprocess.DEVNULL, timeout=120)
    except subprocess.TimeoutExpired:
        return (-1, 'timeout')
    return (r.returncode, r.stdout if r.returncode == 0 else re.sub(r'\(version.*', '', r.stderr.strip().splitlines()[-1] if r.stderr.strip() else ''))

def comparable(result):
    # Header first, then rows in a stable order.
    lines = result.splitlines()
    return lines[:1] + sorted(lines[1:])

def row_count(result):
    return max(len(result.splitlines()) - 1, 0)

names = subprocess.check_output(['git', '-C', REPO, 'ls-tree', '--name-only', f'{HEAD}:{GOLDEN}']).decode().split()
same = diff = failed = added = 0
for name in names:
    try: base = statements(BASE, name)
    except subprocess.CalledProcessError: base = []
    head = statements(HEAD, name)
    for index, (label, hsql, hp) in enumerate(head):
        if index >= len(base):
            h = run(substitute(hsql, hp))
            if h[0] == 0:
                added += 1
                print(f'ADDED   {name} [{label}] rows={row_count(h[1])}')
            else:
                failed += 1
                print(f'FAILED  {name} [{label}] (added)\n   head: {h[1][:300]!r}')
            continue
        _, bsql, bp = base[index]
        if bsql == hsql and bp == hp: same += 1; continue
        b, h = run(substitute(bsql, bp)), run(substitute(hsql, hp))
        if b[0] != 0 or h[0] != 0:
            failed += 1
            print(f'FAILED  {name} [{label}]\n   base: {b[1][:300]!r}\n   head: {h[1][:300]!r}')
        elif comparable(b[1]) == comparable(h[1]):
            same += 1
            print(f'EQUAL   {name} [{label}] rows={row_count(b[1])}')
        else:
            diff += 1
            print(f'DIFFER  {name} [{label}]\n   base: {b[1][:300]!r}\n   head: {h[1][:300]!r}')
    for label, _, _ in base[len(head):]:
        print(f'REMOVED {name} [{label}]')
print(f'\n{same} statements equivalent, {added} added, {diff} differ, {failed} failed to run')
sys.exit(1 if diff or failed else 0)
