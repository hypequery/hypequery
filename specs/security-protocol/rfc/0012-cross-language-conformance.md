# RFC 0012: Cross-language conformance

- Status: Proposed
- Version: conformance manifest 1, adapter protocol 1

## Summary

This RFC defines how an implementation of the Hypequery security protocol in
any language proves conformance against the language-neutral fixtures in
`specs/security-protocol/fixtures/`. It specifies three artifacts:

1. a conformance manifest that indexes every fixture family, file, and role;
2. an adapter protocol that lets a runner drive an implementation over
   standard input and output without language-specific assumptions;
3. a fuzz seed corpus with the obligations every implementation owes each
   seed.

The runner mechanically compares implementation behavior against the
fixtures. Family fixtures remain the source of truth; the manifest only
indexes them. If the manifest and a fixture file disagree, the manifest is
wrong.

## Conformance manifest

The manifest lives at `specs/security-protocol/fixtures/manifest.json` and
has `kind: "hypequery-conformance-manifest"`, `version: 1`, a `families`
array, and a `fuzz` array.

Each family entry contains:

- `name`: the fixture directory name, for example `tagged-values-v1`;
- `rfc`: the four-digit RFC number the family exercises;
- `codePrefixes`: the closed list of stable failure-code prefixes the family
  may produce, for example `["HQ_VALUE_"]`;
- `files`: entries of `{path, role}` where `path` is relative to the
  fixtures directory and `role` is one of the closed set below. A file
  entry may add `sections`: an array of JSON pointers selecting the case
  arrays inside a file whose root is not itself an array.

The closed role set:

- `success`: cases the implementation must accept;
- `rejection`: cases the implementation must reject with the exact stable
  failure code named by the case's `error` field;
- `identity`: cases pinning exact canonical bytes and the domain-separated
  SHA-256 identity of a success case with the same `id`;
- `portable`: SQL sources that must compile to the exact pinned protocol
  expression and dependency list;
- `non-portable`: SQL sources that must fail with the pinned stable code and
  the pinned zero-based `start` offset.

Every fixture file in every family directory must be covered by exactly one
manifest entry. Case `id` values are unique within one family and role.

Pinned outputs are normative. Because fixtures pin identifier `segments`,
non-portable `start` offsets, canonical bytes, and hashes, those exact values
are conformance requirements; relaxing any of them is a specification change,
not a runner option.

Each `fuzz` entry contains `{path}` and optionally `family` when every seed
in the file targets one family. Seed files whose entries carry their own
`targets` array omit `family`.

## Adapter protocol

A conformance run involves a runner and an adapter. The adapter wraps the
implementation under test. The runner spawns the adapter as a child process
given only an argument vector; the adapter reads newline-delimited JSON
(NDJSON) on standard input and writes NDJSON on standard output. Standard
error is reserved for human diagnostics and is never parsed. Encoding is
UTF-8 without a byte-order mark; one JSON object per line.

The runner sends, in order:

1. `{"type": "hello", "protocol": 1, "manifestVersion": 1}`;
2. one `{"type": "case", "seq": n, "family": ..., "role": ..., "case": {...}}`
   per selected case, where `case` is the raw fixture entry (or a fuzz seed
   with `role: "fuzz"`) and `seq` is a monotonically increasing integer.
   When the manifest file entry declares `sections`, the message adds
   `"section"` with the JSON pointer the case was read from;
3. `{"type": "end"}`.

The adapter answers the hello first:

```json
{"type": "hello", "protocol": 1, "implementation": "@hypequery/protocol",
 "version": "0.9.0", "language": "typescript",
 "families": ["tagged-values-v1", "identifiers-v1"]}
```

The runner only sends cases for families the adapter announced; this
intersection is how one runner serves partial implementations, such as a
datasets adapter that implements only `sql-portability-v1`.

The adapter then answers every case in the order received with exactly one
result line:

- `{"type": "result", "seq": n, "ok": true, "output": {...}}` — accepted;
  `output` carries the role-specific fields defined below and may be omitted
  when the role requires none;
- `{"type": "result", "seq": n, "ok": false, "code": "HQ_..."}` — rejected
  with a stable failure code;
- `{"type": "result", "seq": n, "skipped": true, "reason": "..."}` —
  permitted only for cases this RFC marks host-model conditional.

The runner enforces a per-case timeout. A case with no result inside the
timeout fails. If the adapter exits before `end`, the in-flight case fails,
the runner may respawn the adapter once, and remaining cases continue; a
second premature exit fails the run. A line that is not valid JSON, an
unknown `seq`, or a duplicate `seq` is a protocol error and fails the run.

Adapters materialize `generator` cases in-process from the normative
semantics in the family fixture README. Generator descriptors, not expanded
values, cross the wire: expansions include non-finite floats and multi-
megabyte payloads that JSON transport cannot carry faithfully, and
`tagged-values-v1` forbids passing `sourceUtf8` through an ordinary JSON
parser before duplicate-key detection.

### Host-model conditional cases

Rejection cases generated by the `unsafe-accessor` generator construct an
object whose property is served by a computed accessor instead of a plain
data property. They prove a validator reads each property exactly once and
defends against mutable lookups. Implementations whose input value model
cannot express computed accessors (for example, a validator that consumes
parsed JSON dictionaries) cannot construct the input; their adapters respond
`skipped` with a reason. The runner reports skips distinctly from passes.
Only `unsafe-accessor` cases are host-model conditional; skipping any other
case is a conformance failure.

Skipping is permitted because the input cannot be constructed, not because the
guarantee is optional. Every implementation MUST additionally declare, in its
conformance report, a language-specific hostile-object suite covering its own
conversion mechanisms — getters, proxies, `toJSON`, `__str__`, `__getattr__`,
descriptors, and comparable hooks — together with the count of cases it
contains. TypeScript covers at least getters, `toJSON`, custom prototypes,
symbol keys, and sparse arrays; Python covers at least property descriptors,
custom mappings, `__iter__`, `__str__`, `dict` subclasses, and cyclic
structures.

A report that skips the shared cases and declares no such suite is incomplete,
not passing. Without both layers `HQ_VALUE_UNSAFE_OBJECT` would be the one
frozen failure code no implementation is ever required to demonstrate.

## Operations and pass criteria

The adapter dispatches on `family`, `role`, and in-case fields. No operation
name crosses the wire.

| Family | Dispatch | Success output |
| --- | --- | --- |
| tagged-values-v1 | `sourceUtf8` → duplicate-aware decode; otherwise validate the `value` or materialized generator with optional `declaredClickHouseType` | `canonicalHex`, `sha256` |
| identifiers-v1 | `mode: "simple"` or `"qualified"` parse | `segments` |
| expressions-v1 | section `/expressions` or `mode: "expression"` → expression validation; section `/queries` or `mode: "query"` → semantic query validation | none |
| query-schemas-v1 | schema validation | none |
| query-implementations-v1 | `surface: "sql-expression"` → SQL expression validation; otherwise query implementation validation | none |
| query-events-v1 | query event validation | none |
| query-diagnostics-v1 | query diagnostics validation | none |
| deployments-v1 | validation; `identity` role → canonical encode and identity hash | identity: `canonical`, `sha256` |
| deployment-bundles-v1 | validation; `identity` role → canonical encode and identity hash | identity: `canonical`, `sha256` |
| deployment-releases-v1 | validation; `identity` role → canonical encode and identity hash | identity: `canonical`, `sha256` |
| sql-portability-v1 | compile the `sql` source | `expression`, `dependencies` |

An `identity` case supplies only the shared `id`; the adapter locates the
success case with the same `id` in the same family and derives the canonical
form and identity from that value.

Pass criteria:

- `success`: `ok` is true; when the family defines success output, every
  output field equals the fixture field exactly (`canonicalHex` and `sha256`
  for tagged values, `segments` for identifiers);
- `identity`: `ok` is true, `output.canonical` equals the fixture
  `canonical` string, `output.sha256` equals the fixture `sha256`;
- `portable`: `ok` is true, `output.expression` deep-equals the fixture
  `expression`, `output.dependencies` equals the fixture `dependencies` in
  order;
- `rejection`: `ok` is false and `code` equals the fixture `error` exactly;
- `non-portable`: `ok` is false, `code` equals the fixture `code`, and
  `output.start` equals the fixture `start`;
- `fuzz`: see below.

## Fuzz seed corpus

`fixtures/fuzz-seeds-v1/` holds deterministic adversarial seeds replayed
verbatim on every conformance run. The corpus is a foundation for growth: a
mutating fuzzer is explicitly out of scope for this RFC, and any input that
crashes an implementation later must be minimized and added here as a seed.

For every seed an implementation must, within the runner timeout:

- return `ok: true`, or
- return `ok: false` with a code matching `^HQ_[A-Z0-9_]+$`, and
- never crash, hang, or partially execute the input.

Implementations must enforce their documented size, depth, and node limits
before unbounded allocation. Memory-boundedness is a normative obligation of
this RFC; the runner mechanically enforces only the timeout, the absence of
crashes, and well-formed results. A memory-exhaustion failure observed by
other means is a conformance failure even though the runner cannot detect it
directly.

## Runner obligations

A conforming runner:

- reads the manifest and fixture files, and enumerates cases without
  interpreting family semantics;
- spawns the adapter without a shell and passes no language-specific
  environment;
- reports every case as pass, fail, or skip, with the expected and actual
  code or output on failure;
- exits zero only when no case failed.

The TypeScript reference runner and reference adapter live in
`@hypequery/protocol-conformance`. The package bundles a snapshot of the
fixtures taken at build time, so a pinned package version is a pinned
conformance target; runners accept an explicit fixtures directory to test
against newer or local specs.

## Non-goals

- Mutating or coverage-guided fuzzing; only seed replay is specified.
- Determinism and cost-class metadata for the RFC 0003 function registry;
  the registry currently names functions and arity only.
- Bundle artifact byte verification (RFC 0007) — the fixtures describe
  manifests, not filesystems.
- Performance measurement; the timeout is a liveness bound, not a benchmark.

## Compatibility

The manifest `version` and adapter `protocol` version advance independently
of fixture family versions. Adding a family or file to the manifest is
additive; changing a role's pass criteria or a wire message shape requires a
new protocol version. An adapter that receives a hello with an unsupported
`protocol` must exit non-zero without answering cases.
