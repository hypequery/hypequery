---
"@hypequery/protocol": minor
"@hypequery/protocol-conformance": minor
---

Accept RFC 0005 and freeze query implementation extension 1.

The accepted text records rules both implementations already enforce and the
Proposed text left implicit. Field sets are exact and every field is required,
with an unknown field reported before any value on a known one. A non-string
`kind` is a type error and an unrecognised string is an unknown kind, on the
implementation, on a parameter source, and on a tenant policy alike;
`sql-expression` is not a member of the implementation union, because the two
surfaces share an error domain and a limit set but are separate validators.

Trusted text is non-blank, where "blank" is the set `String.prototype.trim`
removes — which includes U+FEFF, so a byte-order mark alone is blank rather
than content. Parameter names, physical sources, and expression dependencies
reject duplicates. A `not-required` tenant policy alongside a tenant-sourced
parameter is a contradiction and is refused, and a `required` policy must name
the one tenant-sourced parameter, of which there must be exactly one. An
embedded semantic query or output schema keeps its own validation but reports
in this surface's error domain, so a caller handles one error type.
Entrypoints and dependencies are RFC 0002 qualified identifiers.

Every rule was checked against both implementations before being recorded, in
a 24-case run in which all 24 agreed. Neither implementation changed.

The shared `query-implementations-v1` corpus grows from 9 rejections and 7
successes to 32 and 10, pinning each recorded rule.
