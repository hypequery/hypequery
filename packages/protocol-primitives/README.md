# @hypequery/protocol-primitives

Internal shared primitives for Hypequery packages. This package owns canonical
wire-value handling and logical identifier validation so public packages can
share one implementation without depending on the full deployment protocol.

Most users should import from `@hypequery/clickhouse`, `@hypequery/datasets`, or
`@hypequery/serve`. `@hypequery/protocol` continues to re-export these primitives
for compatibility.

## License

Apache-2.0.
