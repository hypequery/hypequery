---
"@hypequery/serve": minor
"@hypequery/playground": minor
"@hypequery/studio": minor
"@hypequery/cli": minor
---

Add the hypequery playground: `hypequery dev` now serves an interactive UI at
`/__dev` alongside the API.

- `@hypequery/serve` gains a `mount` option on `serveDev` and a `./dev` subpath
  exporting `serveDev` + `DevIntegrationApi` (the root `serveDev` export is now
  `@deprecated` in favour of `@hypequery/serve/dev`).
- `@hypequery/playground` (new) is the local gateway implementing gateway
  contract v0: `/meta`, `/registry`, `/execute` (through the real pipeline),
  `/history`, and `/events` SSE, with `node:sqlite` query history and a
  localhost/token security guard.
- `@hypequery/studio` (new) is the embeddable React UI, served same-origin by
  the gateway.
- `@hypequery/cli` wires the gateway into `hypequery dev` (`--no-ui` to disable).
