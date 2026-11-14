# Agent skills

The source of hypequery's [Agent Skills](https://agentskills.io): one directory
per skill with a `SKILL.md` (YAML frontmatter `name` and `description`, then
instructions). `hypequery skill install` writes them where coding agents load
them — `.claude/skills/` for Claude Code, `.agents/skills/` for Cursor and Codex.

Both CLIs and the [Claude Code plugin](../plugins/claude-code/hypequery/) ship
copies. After editing a skill here:

```bash
node packages/cli/scripts/generate-skills.mjs          # TypeScript CLI and the Claude Code plugin
rsync -a --exclude README.md skills/ python/hypequery/src/hypequery/cli/templates/skills/   # Python
```

Drift tests in both packages fail until the copies match
(`node packages/cli/scripts/generate-skills.mjs --check` checks the TypeScript
and plugin copies without writing). Keep every API a skill
names real: check it against the docs and the package READMEs.
