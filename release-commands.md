# hypequery release commands

## npm canaries

A successful main push publishes snapshot builds under the `canary` dist-tag for
`@hypequery/clickhouse`, `datasets`, `deployment`, `serve`, `cli`, `mcp`,
`protocol`, `protocol-conformance` and `react`. The workflow requires the package
build and installed Python/React/MCP client qualification first.

The CI job creates a temporary changeset, versions a canary snapshot, publishes,
and restores its workspace. These snapshots do not consume the committed stable
changesets. Pin exact snapshot versions for qualification; a moving dist-tag is
not release evidence.

## npm stable versions

Each user-facing change includes its Changeset. After the implementation PRs
merge, the main workflow creates or updates one `chore: release` PR that consumes
the queued files and updates versions, dependency ranges, changelogs and the lock.
Review that PR after the complete stack lands, so one release contains all client
prerequisites. Preserve the changesets until they are represented in that PR.

The repository's supported version command is:

```bash
pnpm release:version
```

Run it only on a release branch when preparing the equivalent PR locally. It
changes tracked files and does not publish. After review and merge, main's
Changesets job publishes eligible packages with `pnpm release:publish`. Main's
canary job also runs on the push. Merging to main can therefore publish npm;
opening a draft release PR does not.

Before publishing, require green monorepo checks and both installed-client
matrix jobs on the candidate. After publishing, install the exact versions in a
fresh directory and repeat generation, strict React compilation, browser queries
and MCP stdio. Record package versions, registry integrity values, source SHA and
qualification evidence. A green packed-development run alone does not establish
registry availability or provenance.

## Python SDK and CLI

Python uses its own version, Towncrier fragments and PyPI release workflow. npm
Changesets do not version Python. See the
[Python release guide](python/hypequery/RELEASING.md), including its integrated
beta checklist and npm prerequisites. Python tag pushes publish only after the
exact-commit verification graph passes. Manual rehearsals build artifacts only.
