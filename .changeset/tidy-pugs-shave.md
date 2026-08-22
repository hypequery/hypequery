---
"@hypequery/datasets": patch
"@hypequery/serve": patch
---

Declare `zod` as an optional peer dependency so package managers warn when a
zod 4 install is hoisted over the zod 3 these packages build against.

Both packages depend on `zod@^3` but declared no peer range, so
`npm install @hypequery/serve zod` silently resolved zod 4 at the top level with
no warning. The first `query({ input: z.object(...) })` then failed to compile
with `Type 'ZodObject<...>' is missing the following properties from type
'ZodType<any, any, any>': _type, _parse, _getType, _getOrReturnCtx, and 7 more`,
which gives no hint that a version mismatch is the cause.

The peer is marked optional, so nothing breaks for consumers who never install
zod directly. Quick Start now pins `zod@^3` in its install commands.
