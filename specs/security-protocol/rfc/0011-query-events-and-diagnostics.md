# RFC 0011: Query events and diagnostics

- Status: Proposed
- Version: query event 1, query diagnostics 1

## Summary

This RFC defines two independently versioned, metadata-only records: the
query event, the default execution record every runtime may emit, and the
query diagnostics projection, a privileged record available only under the
RFC 0009 diagnostic capability.

Both records are closed under validation: they define exact field sets, size
caps, and stable failure codes. Neither can carry raw input, result rows,
Error objects, SQL text, parameter values, raw tenant identifiers, or
credentials — there is no field that accepts them. Retention and redaction
classes define how long each field class may be kept and who may read it.

## Query event

A query event has `kind: "hypequery-query-event"`, `version: 1`, and these
fields:

- `eventId`: server-generated authoritative event identifier, 64 lowercase
  hexadecimal characters;
- `occurredAt`: RFC 3339 UTC timestamp with second or millisecond precision;
- `target`: the deployment target (`project`, `environment`) as defined by
  RFC 0008;
- `queryName`: the executed dataset, metric, or named-query identifier;
- `operation`: `query`, `command`, or `insert` (RFC 0010);
- `outcome`: `success` or `failure`;
- `errorCategory`: one of the RFC 0010 minimum categories — required when
  `outcome` is `failure`, forbidden when it is `success`;
- `durationMs`: elapsed execution time, at most 24 hours;
- `rowCount`: optional affected or returned row count, at most 10^12;
- `tenantFingerprint`: optional server-derived tenant fingerprint (64
  lowercase hexadecimal characters). It is derived from the tenant context
  with a server-held secret; the raw tenant identifier never appears;
- `correlationId`: optional caller-supplied external correlation identifier.
  It is never authoritative and never influences routing, caches, or
  authorization (RFC 0010).

## Diagnostics projection

A diagnostics projection has `kind: "hypequery-query-diagnostics"`,
`version: 1`, and these fields:

- `eventId`: the event this projection extends;
- `queryId`: the authoritative execution identifier (RFC 0010);
- `terminalReason`: `completed`, `aborted`, `deadline-exceeded`, or `drained`,
  matching the RFC 0010 cancellation precedence;
- `attempts`: execution attempts, from 1 through 64;
- `runtimeIdentity`: optional digest of the runtime artifact that executed
  the query;
- `debugQuery`: optional non-executable RFC 0010 debug form. It contains
  placeholders and declared types only, never parameter values;
- `safeMessage`: optional message from a category permitted to carry one.

The projection is issued only to holders of the diagnostic capability, and
every access is audited. It adds execution-shape detail, never data: result
rows, parameter values, executable SQL, and credentials remain
unrepresentable.

## Redaction and retention classes

Every conceivable execution fact belongs to one of four classes:

| Class | Rule | Examples |
| --- | --- | --- |
| Prohibited | Never present in either record | Raw input, result rows, Errors, SQL text, parameter values, raw tenant identifiers, credentials |
| Metadata | Default event fields; standard retention | Identifiers, timestamp, target, query name, operation, outcome, category, counts |
| Fingerprint | Derived only, with a server-held secret | `tenantFingerprint` |
| Diagnostic | Privileged projection only; shorter retention; access audited | Debug form, terminal reason, attempts, runtime identity, safe message |

Products may shorten but not extend diagnostic retention, and may tighten but
not raise the size caps below.

## Evolvability

Within a version the field set is closed: an unknown field fails validation,
so a record carrying an unlisted addition is rejected rather than
misinterpreted. Across versions a consumer that does not recognize
`version` MUST reject the record with `HQ_*_INVALID_VERSION` and MAY skip it
without failing the surrounding event stream. New fields therefore require a
new version; older consumers either reject or ignore safely, and never
silently accept a record they cannot fully interpret.

## Limits

| Limit | Maximum |
| --- | ---: |
| `correlationId`, `safeMessage` UTF-8 bytes | 1,024 |
| `debugQuery` UTF-8 bytes | 4,096 |
| `durationMs` | 86,400,000 |
| `rowCount` | 10^12 |
| `attempts` | 64 |

Free-text fields reject control characters. Products may lower but not raise
these limits while claiming version 1 conformance.

## Stable failure codes

Query events use `HQ_EVENT_` codes and diagnostics use `HQ_DIAGNOSTICS_`
codes, each with the same six members:

- `TYPE`
- `UNKNOWN_FIELD`
- `INVALID_VERSION`
- `INVALID_VALUE`
- `TOO_LARGE`
- `UNSAFE_OBJECT`

Nested validators compose without leaking: an invalid target or query name
surfaces as `INVALID_VALUE` at its path, keeping the record's public code set
closed.

## Security

The default event is safe to emit broadly because every sensitive class is
structurally absent rather than redacted after the fact. Tenant correlation
happens only through a derived fingerprint. The privileged projection adds
execution shape under an audited capability while keeping values, executable
SQL, and credentials unrepresentable. Records are validated before encoding;
their canonical bytes are the UTF-8 encoding of their RFC 8785 serialization,
and events are identified by `eventId` rather than content identity.
