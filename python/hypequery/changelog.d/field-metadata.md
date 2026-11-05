- Dimensions and measures accept `synonyms`, `examples`, `format`, `unit` and
  `currency` (an ISO 4217 code), as in TypeScript:
  `dimension.string(synonyms=("market",), examples=("DE", "FR"))`,
  `measure.sum("amount", format="#,##0.00", currency="EUR")`. Client contracts
  advertise them in field annotations (RFC 0018 amendment, 5 November 2026), and
  `hypequery mcp` returns them from `get_dataset_schema`, so agents see the
  names and values people actually use. Deployment contracts do not publish
  them yet.
- Field metadata is negotiated so released consumers keep working: live
  discovery emits it only to requests whose `x-hypequery-client-features` header
  names `field-metadata` (both MCP backends send it) and varies on that header.
  Other requests, and `export_client_contract` unless given
  `field_metadata=True`, get the label/description view that `@hypequery/mcp`
  and `@hypequery/cli` releases before this one accept. Invalid vocabulary still
  fails export. `hypequery.protocol` adds `accepts_client_field_metadata`,
  `parse_client_contract_features`, `without_client_field_metadata` and the
  header constants.
