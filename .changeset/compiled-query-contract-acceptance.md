---
"@hypequery/protocol": minor
"@hypequery/protocol-conformance": minor
---

Accept RFC 0010 and freeze compiled query 1.

The contract fixes the closed operation set, named typed parameters carrying
their own declarations, a closed settings allow-list applied only by trusted
components, deadline precedence in which a caller may shorten but never extend
the window and caller cancellation outranks expiry, a redacted debug form that
is deliberately invalid as database SQL, and a closed public error category
set.

Accepted on one implementation plus a recorded obligation on the other, rather
than on an agreement between two, and the RFC says so. The Python planner
implements the plannable surface. `@hypequery/clickhouse` does not yet satisfy
the parameter rule: it accepts `{name:Type}` placeholders but rewrites them
client-side into positional markers and substitutes escaped literals into the
statement, so a value reaches the database inside SQL text. Acceptance turns
that into a defect against a frozen contract — the package must bind through
ClickHouse's native server-parameter mechanism, with its public placeholder API
unchanged. Tracked as TSP-04.
