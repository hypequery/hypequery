---
"@hypequery/datasets": minor
"@hypequery/serve": minor
"@hypequery/mcp": minor
"@hypequery/cli": minor
---

**Breaking:** move to zod 4. `@hypequery/datasets` and `@hypequery/serve` now take `zod@^4` as their peer dependency, and `hypequery init` scaffolds `zod@^4.6.5`. Projects still on zod 3 must upgrade zod to keep using `query({ input: z.object(...) })` and other schema APIs.

JSON Schema and OpenAPI output now comes from zod 4's native `z.toJSONSchema` instead of `zod-to-json-schema`, which is no longer a dependency. Generated schemas are unchanged apart from these corrections: reused sub-schemas are inlined instead of emitting dangling `$ref`s in toolkit descriptions; request bodies for non-strict objects no longer claim `additionalProperties: false`, since zod strips unknown keys rather than rejecting them; and `.int()` and `.email()` fields advertise the safe-integer bounds and pattern zod enforces. Validation error messages follow zod 4's wording, for example `Invalid option: expected one of …` instead of `Invalid enum value`.
