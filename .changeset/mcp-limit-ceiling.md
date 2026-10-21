---
'@hypequery/datasets': patch
---

MCP tool schemas built from a client contract now advertise each endpoint's `maxLimit` as the `limit` maximum. An agent asking for more rows gets an argument error instead of a silently clamped page. HTTP schemas keep clamping, as both Serve implementations do.
