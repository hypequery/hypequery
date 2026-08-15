# Portable expression v1 fixtures

This family accompanies RFC 0003 and covers the closed semantic expression registry plus metric and dataset query envelopes.

`success.json` exercises accepted expressions and queries. `rejections.json` pins every stable failure code, including generated depth, width, node-count, and unsafe-accessor cases.

Each rejection selects the `expression` or `query` validation surface and contains exactly one literal value or deterministic generator.
