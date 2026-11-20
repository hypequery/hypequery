---
"@hypequery/cli": minor
"@hypequery/mcp": patch
---

One-command onboarding from a coding agent's chat.

- `hypequery start` installs the agent skills and adds the MCP server to the agents on this machine, then prints the next step. It never prompts: what only a person can do, such as putting the ClickHouse password in `.env`, comes back as `needs`.
- `hypequery next` prints the one onboarding step that is due, with instructions written for an agent (never ask for the password in chat; show the dataset plan before writing datasets).
- `hypequery doctor` checks Node, the ClickHouse connection and whether its user is read-only, `.env` (git-ignored, not world-readable), datasets and Serve API, Cloud sign-in, every agent's MCP entry and the skills, naming the fix for each problem.
- `hypequery mcp:install` adds the local `hypequery mcp` server (absolute Node path, credentials kept in `.env`) or `--hosted` connector to Claude Code, Cursor, Codex or Claude Desktop. It changes only entries it wrote, backs the file up, and supports `--dry-run` and `--remove`.
- `hypequery login --device --no-wait` prints the link and code and exits; run it again after approving to finish. Agents can relay the link in chat instead of blocking on a poll.
- `hypequery skill install` now defaults to `--scope user` (`~/.claude/skills`, `~/.agents/skills`) and reports every skill file by absolute path. Pass `--scope project` for the previous behaviour.
- `HYPEQUERY_PROJECT_DIR` makes the CLI change into a project before loading `.env`; MCP entries written by `mcp:install` set it.
- The CLI now declares `engines.node >=22.12.0`, which its dependencies already required, and exits with a clear message on older Node. `@hypequery/mcp` declares `>=20`.
