# RFC 0011: Query events and diagnostics

- Status: Accepted
- Accepted: 2026-10-01
- Version: query event 1, query diagnostics 1

Acceptance freezes query event 1 and query diagnostics 1. Changing a field,
a format, a limit, the validation order, or a stable code now requires a new
version, not an edit.

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
- `occurredAt`: RFC 3339 UTC timestamp, `YYYY-MM-DDTHH:MM:SSZ` or
  `YYYY-MM-DDTHH:MM:SS.sssZ` (exactly zero or three fractional digits, an
  uppercase `T` and `Z`, no offset). It must name a real instant: months
  01–12, days valid for the month and year (including leap years), hours
  00–23, minutes and seconds 00–59. Leap seconds and `24:00` are rejected;
- `target`: the deployment target (`project`, `environment`) as defined by
  RFC 0008;
- `queryName`: the executed dataset, metric, or named-query identifier;
- `operation`: `query`, `command`, or `insert` (RFC 0010);
- `outcome`: `success` or `failure`;
- `errorCategory`: one of the RFC 0010 minimum categories — required when
  `outcome` is `failure`, forbidden when it is `success`;
- `durationMs`: elapsed execution time as an integer number of milliseconds,
  from 0 through 24 hours;
- `rowCount`: optional affected or returned row count, an integer from 0
  through 10^12;
- `tenantFingerprint`: optional server-derived tenant fingerprint (64
  lowercase hexadecimal characters). It is derived from the tenant context
  with a server-held secret, as defined in RFC 0009 § Tenant fingerprint. The
  raw tenant identifier never appears;
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
- `runtimeIdentity`: optional SHA-256 digest of the runtime artifact that
  executed the query, as 64 lowercase hexadecimal characters with no
  algorithm prefix;
- `debugQuery`: optional non-executable RFC 0010 debug form. It contains
  placeholders and declared types only, never parameter values;
- `safeMessage`: optional RFC 0010 safe message.

The projection carries no error category, so a validator cannot check two
producer obligations; producers MUST enforce them before emitting:

- `debugQuery` is copied from the compiler's RFC 0010 debug form, never
  assembled from request input, adapter error text, or executable SQL;
- `safeMessage` is the safe message of the execution's RFC 0010 error
  envelope, so it is set only for a failed execution. For `internal` and
  other server-fault categories it MUST NOT contain adapter error text, SQL,
  values, or tenant identifiers.

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
not raise the byte limits below.

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

Integer fields are compared by value, not by spelling: the JSON numbers `1`
and `1.0` are both the integer 1 and are accepted, while `1.5` is rejected.
Parsers that keep `1.0` as a float must accept it when its value is
integral. Identifier fields (`eventId`, `queryId`, `tenantFingerprint`,
`runtimeIdentity`) are exactly 64 lowercase hexadecimal characters.

Free-text fields (`correlationId`, `debugQuery`, `safeMessage`) must be
well-formed Unicode and are measured in UTF-8 bytes. They reject the
control characters U+0000–U+001F, U+007F, and U+0080–U+009F, and unpaired
surrogates, which have no UTF-8 encoding. `debugQuery` alone may also contain tab (U+0009),
line feed (U+000A), and carriage return (U+000D), because the compiler's debug
form spans lines; `correlationId` and `safeMessage` are single-line.

Products may lower the two byte limits but not raise any limit while claiming
version 1 conformance. The numeric bounds are fixed.

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

### Validation order

A record can fail several checks; the first failing check determines the code,
so every implementation reports the same one:

1. The root is not a plain object: `TYPE`. The root has a custom prototype,
   symbol keys, accessor properties, or non-enumerable properties:
   `UNSAFE_OBJECT`.
2. `kind` is missing or not a string: `TYPE`; any other value than this
   record's kind: `INVALID_VALUE`.
3. `version` is missing or not a number: `TYPE`; any number other than 1:
   `INVALID_VERSION`. The version is checked before the field set, so a
   newer record that adds fields still reports `INVALID_VERSION` and a
   consumer can skip it as Evolvability requires.
4. Any field outside the version 1 set: `UNKNOWN_FIELD`; then any missing
   required field: `TYPE`.
5. Each field in the order this RFC lists it. For the query event:
   `eventId`, `occurredAt`, `target`, `queryName`, `operation`, `outcome`,
   `errorCategory` (its presence must match `outcome`, then its value),
   `durationMs`, `rowCount`, `tenantFingerprint`, `correlationId`. For
   diagnostics: `eventId`, `queryId`, `terminalReason`, `attempts`,
   `runtimeIdentity`, `debugQuery`, `safeMessage`. Within a field, a wrong
   JSON type is `TYPE`, an over-limit free-text field is `TOO_LARGE`, and
   any other violation is `INVALID_VALUE`. `target` is the exception: any
   RFC 0008 target failure, including a wrong type or an unsafe object, is
   `INVALID_VALUE` at `$.target`.

## Security

The default event is safe to emit broadly because every sensitive class is
structurally absent rather than redacted after the fact: its only free-text
field is the caller's own `correlationId`. Tenant correlation happens only
through a derived fingerprint. The privileged projection adds execution shape
under an audited capability. It has no field for rows, parameter values, or
credentials. Its free-text `debugQuery` and `safeMessage` fields are bounded
and validated, but a validator cannot tell a placeholder from a literal, so
keeping values out of them rests on the producer obligations above and on the
RFC 0010 debug form rules. Until a dedicated audit RFC is accepted, the
RFC 0009 minimum audit record applies to every diagnostics access.

Records are validated before encoding; their canonical bytes are the UTF-8
encoding of their RFC 8785 serialization, and events are identified by
`eventId` rather than content identity.
