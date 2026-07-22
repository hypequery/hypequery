# @hypequery/protocol-conformance

Cross-language conformance runner and TypeScript reference adapter for the
Hypequery security protocol. It drives any implementation of the protocol
against the language-neutral fixtures in `specs/security-protocol/fixtures/`
and checks the results against the pinned expectations.

See [RFC 0012](../../specs/security-protocol/rfc/0012-cross-language-conformance.md)
for the manifest schema, the adapter wire protocol, and the pass criteria.

## Usage

```sh
# Run the whole suite against the bundled TypeScript reference adapter.
hypequery-protocol-conformance run -- hypequery-protocol-reference-adapter

# Run against another implementation (any language). Everything after `--`
# is the adapter command, spawned without a shell.
hypequery-protocol-conformance run --fixtures ./fixtures -- python -m my_impl.adapter

# Restrict to families, skip or isolate the fuzz corpus, emit JSON.
hypequery-protocol-conformance run --families sql-portability-v1 --skip-fuzz \
  --report json -- node ./adapter.mjs

# List the enumerated case counts per family.
hypequery-protocol-conformance list
```

Exit codes: `0` all cases passed, `1` conformance failures, `2` setup or
protocol error.

## Writing an adapter

An adapter reads newline-delimited JSON on stdin and writes it on stdout. It
answers a `hello` with the families it supports, then one `result` per `case`.
The `createStdioAdapter` helper implements the loop; a handler maps
`(family, role, case)` to `{ ok: true, output? }`, `{ ok: false, code }`, or
`{ skipped: true, reason }`. The bundled fixture snapshot means a pinned
package version is a pinned conformance target; pass `--fixtures` to test
against newer or local specs.
