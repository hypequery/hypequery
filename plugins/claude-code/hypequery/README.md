# hypequery plugin for Claude Code

One install gives Claude Code:

- **Skills**: `hypequery-onboard` (set up hypequery on a ClickHouse database,
  end to end), `hypequery-datasets` (author datasets in TypeScript or Python)
  and `hypequery-query` (answer questions with hypequery's MCP tools instead of
  SQL). They run as `/hypequery:hypequery-onboard` and so on, and Claude also
  loads them when a task matches.
- **The hypequery app connector**: a remote HTTP MCP server named `hypequery`
  at `https://mcp.hypequery.com/mcp`. It signs in with OAuth the first time you
  use it (`/mcp`, then follow the browser prompt), and needs no token in any
  file.

## Install

From your shell:

```bash
claude plugin marketplace add hypequery/hypequery --sparse .claude-plugin plugins
claude plugin install hypequery@hypequery
```

`--sparse` checks out only the marketplace file and the plugin instead of the
whole monorepo. Inside a Claude Code session, the equivalent is:

```text
/plugin marketplace add hypequery/hypequery
/plugin install hypequery@hypequery
```

Then run `/reload-plugins` (or start a new session), and `/mcp` to sign in to
the connector.

Updates: the manifest sets no `version`, so each commit to this directory is a
new version. Third-party marketplaces don't auto-update by default; run
`claude plugin marketplace update hypequery` and then
`claude plugin update hypequery@hypequery`, or turn on auto-update for the
marketplace under `/plugin` → Marketplaces.

## Connector URL

`.mcp.json` reads the URL as `${HYPEQUERY_APP_MCP_URL:-https://mcp.hypequery.com/mcp}`.
To point the connector at another hypequery app origin, such as staging, set
`HYPEQUERY_APP_MCP_URL` before starting Claude Code:

```bash
HYPEQUERY_APP_MCP_URL=https://staging.example.com/mcp claude
```

**Until `mcp.hypequery.com` has DNS and a certificate (Cloud rows D-01 and
D-02), the default URL doesn't resolve.** The skills work without it: they
drive the `hypequery` CLI locally. A project that deploys to hypequery Cloud
can also print its own deployment's MCP URL with
`npx hypequery deployment:status --mcp-config`.

## Layout

```text
.claude-plugin/marketplace.json            # repository root: serves this repo as the "hypequery" marketplace
plugins/claude-code/hypequery/
├── .claude-plugin/plugin.json             # the manifest
├── .mcp.json                              # the app connector
└── skills/<name>/SKILL.md                 # generated from skills/ — do not edit here
```

The skills are copies of [`skills/`](../../../skills/), written by
`node packages/cli/scripts/generate-skills.mjs` (the same script that embeds
them in the TypeScript CLI). They are real files, not symlinks, because Claude
Code copies the plugin directory into its cache and doesn't follow links out of
it. `generate-skills.mjs --check` and
`packages/cli/src/templates/claude-code-plugin.test.ts` fail when a copy drifts
from `skills/`; the test also checks that the manifest, the marketplace entry
and `.mcp.json` parse and agree.

## Validate

```bash
claude plugin validate ./plugins/claude-code/hypequery
claude plugin validate .            # the marketplace, and the plugin through it
```

Both pass with one warning, `No version specified`, which is intended (see
Updates). `--strict` therefore fails; don't use it here. Claude Code v2.1.281
and later also check the `.mcp.json` entry.

To try the plugin without touching your own Claude Code settings, use a
throwaway config directory:

```bash
export CLAUDE_CONFIG_DIR="$(mktemp -d)"
claude plugin marketplace add "$PWD"
claude plugin install hypequery@hypequery
claude plugin details hypequery     # Skills (3), MCP servers (1)
claude mcp list                     # plugin:hypequery:hypequery: https://mcp.hypequery.com/mcp (HTTP)
```

## Sources

The plugin and marketplace format was read on **2026-11-14** from Claude Code
2.1.207's `claude plugin --help`, `claude plugin validate --help` and
`claude plugin marketplace add --help`, and from:

- Plugin manifest reference: https://code.claude.com/docs/en/plugins-reference
- Create a marketplace: https://code.claude.com/docs/en/plugin-marketplaces
- Marketplace reference: https://code.claude.com/docs/en/plugins/marketplace-reference.md
- Plugin loading reference (caching, versions, updates): https://code.claude.com/docs/en/plugins/loading.md
- MCP, plugin-provided servers and `${VAR:-default}` expansion: https://code.claude.com/docs/en/mcp

The connector URL and its OAuth (discovery, DCR or CIMD, loopback redirects
for Claude Code) are Cloud's, from AG-17a's `docs/claude-app-readiness.md`.
