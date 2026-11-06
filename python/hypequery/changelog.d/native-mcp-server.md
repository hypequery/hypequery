- A native MCP server: `hypequery mcp [module:api]` serves an API's authorized
  client contract to AI agents over stdio, with the same four tools
  (`list_datasets`, `get_dataset_schema`, `query_metric`, `query_dataset`),
  input schemas, `dataset_guide` prompt and `MCP_*` errors as `@hypequery/mcp`.
  Calls run through `Api.handle` in-process, so the API's authentication,
  policy and tenant apply; `--client-contract-url` bridges a deployed API
  instead, `--self-test` checks the contract and `--print-config` prints an
  `mcpServers` entry. Node is no longer needed. Install the `mcp` extra.
- `hypequery.mcp` exposes the pieces: `ClientContractExecutor`,
  `ApiContractBackend`, `HttpContractBackend`, `create_mcp_server` and
  `serve_stdio`.
- The standalone `hypequery init` app now publishes a client contract
  (`client_profile=ClientQueryProfile()` and `GET /client-contract`), so
  `hypequery mcp app:api` works on a fresh project.
