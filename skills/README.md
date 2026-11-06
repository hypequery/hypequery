# Agent skills

The source of hypequery's [Agent Skills](https://agentskills.io): one directory
per skill with a `SKILL.md` (YAML frontmatter `name` and `description`, then
instructions). `hypequery skill install` writes them where coding agents load
them — `.claude/skills/` for Claude Code, `.agents/skills/` for Cursor and Codex.

Both CLIs ship copies. After editing a skill here:

```bash
node packages/cli/scripts/generate-skills.mjs          # TypeScript: src/templates/skills.generated.ts
rsync -a --exclude README.md skills/ python/hypequery/src/hypequery/cli/templates/skills/   # Python
```

Drift tests in both packages fail until the copies match. Keep every API a skill
names real: check it against the docs and the package READMEs.
