---
"@hypequery/cli": patch
---

Fix `ERR_MODULE_NOT_FOUND: Cannot find package '@hypequery/clickhouse'` on a clean install.

`@hypequery/clickhouse` backs `hypequery init` and `hypequery generate`, but it was declared as an *optional* peer dependency while being imported statically. Package managers skipped installing it (pnpm skips peers entirely; npm skips optional ones), so every command — including `hypequery --help` — crashed before running on a fresh `npx @hypequery/cli` install. It is now a regular dependency.

Type generators are also loaded on demand, so a failure to resolve one no longer takes down unrelated commands.
