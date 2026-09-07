---
"@hypequery/mcp": patch
---

Resolve the package version at build time instead of reading `package.json` at
import time.

Importing `@hypequery/mcp` read its own manifest off `import.meta.url` as a side
effect of module evaluation. A bundler rewrites that URL, so the `URL` handed to
`fs` came from another realm and Node rejected it with `ERR_INVALID_ARG_TYPE` —
which made the package impossible to import from a bundled server build at all.
A Next.js route importing it failed while collecting page data.

`MCP_PACKAGE_VERSION` is unchanged and still cannot drift from the manifest: it
is generated before every build and asserted against `package.json` in tests.
Importing the package now touches no filesystem.
