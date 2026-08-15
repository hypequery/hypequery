# @hypequery/protocol-conformance

`@hypequery/protocol-conformance` checks TypeScript, Python, or any other implementation of the Hypequery security protocol against the same language-neutral fixtures. It includes a command-line runner and the TypeScript reference adapter.

The manifest, adapter wire format, and pass rules are defined in [RFC 0012](../../specs/security-protocol/rfc/0012-cross-language-conformance.md).

## Run the reference adapter

```bash
hypequery-protocol-conformance run -- \
  hypequery-protocol-reference-adapter
```

## Test another language

Everything after `--` is the adapter command. The runner starts it directly, without a shell:

```bash
hypequery-protocol-conformance run \
  --fixtures ./specs/security-protocol/fixtures \
  -- python -m my_implementation.adapter
```

Useful options include:

```bash
# Run selected fixture families and emit JSON.
hypequery-protocol-conformance run \
  --families sql-portability-v1 \
  --skip-fuzz \
  --report json \
  -- node ./adapter.mjs

# Show case counts by family.
hypequery-protocol-conformance list
```

Exit code `0` means every case passed, `1` means conformance failures, and `2` means the runner or adapter protocol could not be set up correctly.

## Adapter shape

An adapter reads newline-delimited JSON from stdin and writes newline-delimited JSON to stdout. It answers the initial `hello` with supported fixture families, then returns one `result` for every `case`.

The exported `createStdioAdapter` helper handles the loop. Your handler maps `(family, role, case)` to one of:

```ts
{ ok: true, output? }
{ ok: false, code }
{ skipped: true, reason }
```

The package includes a pinned fixture snapshot, so a pinned package version is also a pinned conformance target. Pass `--fixtures` to test local or newer specifications.

## License

Apache-2.0.
