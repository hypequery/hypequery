- Add `label` and `description` to `Dataset` and `dataset(...)`. Client-contract
  exports and live discovery now advertise dataset, dimension and measure
  label/description as optional endpoint `annotations` (RFC 0018 amendment), so
  MCP agents listing datasets see each dataset's own description. Whitespace runs
  are folded and blank text is omitted; text over 4096 UTF-8 bytes or containing
  control characters fails export. Annotations are excluded from `schemaHash`,
  so editing a description does not trigger `CLIENT_SCHEMA_CHANGED`. Pair with
  `@hypequery/mcp`/`@hypequery/cli` releases that understand annotations.
