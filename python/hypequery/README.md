# hypequery (Python)

Type-safe ClickHouse semantic layer and serving for Python.

> **Pre-alpha.** The package skeleton and toolchain are in place (PYA-01);
> the protocol, datasets, and serve layers are being built. See
> [`plans/python-datasets-serve-pr-level-plan.md`](../../plans/python-datasets-serve-pr-level-plan.md).

## Install

```sh
pip install hypequery                      # definitions only, framework-free
pip install "hypequery[clickhouse]"        # + query execution
pip install "hypequery[fastapi]"           # + HTTP serving
```

## Layout

| Module | Role |
|---|---|
| `hypequery.protocol` | Reference implementation of the language-neutral security protocol. |
| `hypequery.datasets` | Semantic layer: datasets, dimensions, measures, relationships, metrics. |
| `hypequery.serve` | Strict FastAPI router. Requires the `fastapi` extra. |

These are layered — `serve` → `datasets` → `protocol` — and the lower two are
forbidden from importing a web framework or a database driver. Both rules are
enforced in CI by `import-linter`, not by convention.

## Relationship to TypeScript

Python is not a port of the TypeScript runtime. Both languages implement the
same normative protocol in [`specs/security-protocol/`](../../specs/security-protocol/)
and are proven against the same fixtures by
[`@hypequery/protocol-conformance`](../../packages/protocol-conformance/). Where
the two disagree, the specification is the arbiter and the mismatch is a bug.

Practical consequence: the same logical model produces byte-identical
deployment bundles from either language.

## Development

```sh
uv sync --all-extras --dev     # create the environment
uv run pytest                  # tests
uv run mypy                    # strict type check
uv run ruff check .            # lint
uv run lint-imports            # import boundary contracts
```
