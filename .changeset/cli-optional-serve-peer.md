---
'@hypequery/cli': patch
---

`@hypequery/serve` is now an optional peer dependency. Installing `@hypequery/cli` in a frontend project, for example to run `generate:client` for a Python backend, no longer makes npm install the server packages too. `hypequery dev` says to install `@hypequery/serve` when it is missing.
