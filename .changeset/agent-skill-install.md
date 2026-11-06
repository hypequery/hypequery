---
"@hypequery/cli": minor
---

Add `hypequery skill install`: writes hypequery's agent skills (`hypequery-datasets`, `hypequery-query`) where Claude Code (`.claude/skills/`), Cursor and Codex (`.agents/skills/`) load them. `--agent`, `--scope project|user`, `--check` for CI and `--force`; re-runs are idempotent and edited skills are never replaced without `--force`.
