---
'@hypequery/clickhouse': minor
---

Add CompiledQuery v1 (RFC 0010) beside the legacy positional query path (CH-01).

Introduces `@hypequery/clickhouse` exports for a versioned execution-request contract:
named typed parameters bound to native server placeholders (values never render into SQL
text), a closed operation set (`query`/`command`/`insert`), a bounded settings allow-list,
an authoritative query id plus optional correlation id, caller-vs-policy deadline
precedence, a redacted non-executable debug form, and the stable public error envelope with
a closed category set. Parameter values reuse the RFC 0001 tagged-value contract from
`@hypequery/protocol`.

Additive and non-breaking: the legacy `adapter.query(sql, params[])` path and
`substituteParameters`/`escapeValue` are unchanged. Wiring the built-in `@clickhouse/client`
`{name:Type}` + `query_params` transport is a follow-up (CH-02).
