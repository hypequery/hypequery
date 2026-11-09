# @hypequery/protocol-conformance

`@hypequery/protocol-conformance` checks TypeScript, Python, or any other implementation of the Hypequery security protocol against the same language-neutral fixtures. It includes a command-line runner and the TypeScript reference adapter.

The manifest, adapter wire format, and pass rules are defined in [RFC 0012](https://github.com/hypequery/hypequery/blob/main/specs/security-protocol/rfc/0012-cross-language-conformance.md).

## Run the reference adapter

```bash
npm install -D @hypequery/protocol-conformance
npx hypequery-protocol-conformance run -- hypequery-protocol-reference-adapter
```

The binaries are not named after the package, so to run without installing use
`npx -p @hypequery/protocol-conformance hypequery-protocol-conformance run -- …`.

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

# Per-case adapter timeout in milliseconds.
hypequery-protocol-conformance run --timeout-ms 10000 -- node ./adapter.mjs

# Show case counts by family (also accepts --fixtures).
hypequery-protocol-conformance list
```

`--families` selects cases but deliberately permits partial adapters. Release
gates should also pass `--expect-families` with the complete expected adapter
family set. The run then fails during the handshake if a family was added or
dropped without updating the gate. When both options are present, their family
sets must match so the gate cannot assert a family while filtering out its
cases. Every expected family must also retain at least one case after
`--skip-fuzz` or `--only-fuzz` filtering:

```bash
hypequery-protocol-conformance run \
  --families tagged-values-v1,identifiers-v1 \
  --expect-families tagged-values-v1,identifiers-v1 \
  -- python -m hypequery.protocol.adapter
```

Exit code `0` means no case failed (cases in families the adapter did not
announce are reported as not run; use `--expect-families` to forbid that), `1`
means conformance failures, and `2` means the runner or adapter protocol could not be set up correctly.

## Adapter shape

An adapter reads newline-delimited JSON from stdin and writes newline-delimited JSON to stdout. It answers the initial `hello` with supported fixture families, then returns one `result` for every `case`.

The exported `createStdioAdapter` helper handles the loop. Your
`handle(family, role, case, section)` returns one of:

```ts
{ ok: true, output? }
{ ok: false, code, output? }
{ skipped: true, reason? } // only for the host-model unsafe-accessor case; anywhere else it fails
```

An adapter that announces a host-model conditional family must also declare
`hostileObjectSuite` (`count`, `mechanisms`) in `hello`, as RFC 0012 defines;
`createStdioAdapter` accepts it as an option.

The package includes a pinned fixture snapshot, so a pinned package version is also a pinned conformance target. Pass `--fixtures` to test local or newer specifications.

## Repository gates

With Node.js, pnpm, and `uv` installed, build the workspaces and run the
TypeScript reference and SQL-portability adapters, the Python protocol and
datasets adapters, and the TypeScript/Python serve fixture suites against the
same local fixtures:

```bash
pnpm build
pnpm conformance
```

The Python leg asserts its exact announced family set, so removing a supported
family cannot turn cases into a green “not run” result. See the [fixture update
runbook](https://github.com/hypequery/hypequery/blob/main/specs/security-protocol/fixtures/README.md) when changing a
fixture family or adding an implementation.

## Client contract v1

Both protocol adapters announce `client-contract-v1`. The runner resolves the
family's compact success references and negative JSON Pointer patches before
sending complete cases over NDJSON. It checks canonical identities, normalized
HTTP/MCP output and exact safe rejection paths/messages, including boundary
inputs. Fixture composition neither validates nor repairs runtime artifacts.

## License

Apache-2.0.
