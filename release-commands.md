# hypequery release commands

## npm canaries

A successful main push publishes snapshot builds under the `canary` dist-tag for
`@hypequery/agent`, `clickhouse`, `cloud-client`, `datasets`, `deployment`, `serve`,
`cli`, `mcp`, `protocol`, `protocol-conformance` and `react`. The workflow requires the package
build and installed Python/React/MCP client qualification first.

The CI job creates a temporary changeset, versions a canary snapshot, publishes,
and restores its workspace. These snapshots do not consume the committed stable
changesets. Pin exact snapshot versions for qualification; a moving dist-tag is
not release evidence.

A package's first publish sets npm's `latest` dist-tag even when it is published
with `--tag canary`, so a new package's `latest` points at a canary until its
first stable release. Ship that release before pointing anyone at a bare
`npm install`.

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

### MCP Registry

When a stable release publishes `@hypequery/mcp`, main's `mcp-registry` job
lists that version in the official MCP Registry as
`io.github.hypequery/hypequery`. It publishes `packages/mcp-server/server.json`,
whose versions the release version step keeps equal to the package's.

- The registry accepts a version only if that npm release declares the matching
  `mcpName`. The job waits for npm and fails if the field is missing.
- To publish by hand, or to retry, run the **MCP Registry** workflow from the
  Actions tab. It skips a version the registry already lists.
- Validate a manifest locally with `mcp-publisher validate
  packages/mcp-server/server.json`.

## Release guardrails

Decision 0030 (`specs/security-protocol/decisions/0030-release-guardrails.md`)
explains why these exist. In short, an expired `NPM_TOKEN` once stopped every
publish for three days and nobody noticed.

### Trusted publishing (npm OIDC)

The `canary-release` and `release` jobs in `.github/workflows/ci.yml` publish
with npm trusted publishing. There is no npm token. Each job has
`id-token: write` and installs npm 11.5.1 or later, which `pnpm publish` uses.
Provenance is attached to every publish.

Each package needs a trusted publisher on npmjs.com. Code can't create it. A
maintainer with publish rights on the `@hypequery` packages and 2FA enabled
sets one up for each of these 11 packages:

`@hypequery/agent`, `@hypequery/cli`, `@hypequery/clickhouse`,
`@hypequery/cloud-client`, `@hypequery/datasets`, `@hypequery/deployment`,
`@hypequery/mcp`, `@hypequery/protocol`, `@hypequery/protocol-conformance`,
`@hypequery/react`, `@hypequery/serve`

**On the website**, for each package:

1. Open `https://www.npmjs.com/package/<package>`, go to **Settings**, then
   find the **Trusted Publisher** section.
2. Under **Select your publisher**, click **GitHub Actions**.
3. Fill in the fields exactly. They are case-sensitive.
   - **Organization or user:** `hypequery`
   - **Repository:** `hypequery`
   - **Workflow filename:** `ci.yml` (the file name only, not the path)
   - **Environment name:** leave empty
   - **Allowed actions:** allow `npm publish`. Leave `npm dist-tag` off,
     because the workflow never runs `npm dist-tag`.
4. Save. npm doesn't check the settings when you save them. A mistake shows up
   at the first publish as `ENEEDAUTH` or `E404`.

**Or from a terminal** (npm 11.15.0 or later, logged in, account 2FA on):

```bash
for p in agent cli clickhouse cloud-client datasets deployment mcp protocol protocol-conformance react serve; do
  npm trust github "@hypequery/$p" --repo hypequery/hypequery --file ci.yml --allow-publish
done
npm trust list @hypequery/datasets   # check one
```

A new trusted publisher expires if it doesn't publish within 2 days. Set up all
11 shortly before merging the PR that switches to OIDC. The first push to `main`
after that publishes a canary of every package, which activates every
configuration at once. If one expires, delete it and create it again.

After the first successful OIDC canary:

1. Delete the `NPM_TOKEN` secret under the repository's **Settings → Secrets and
   variables → Actions**. No workflow reads it any more.
2. Revoke that token on npmjs.com under **Access Tokens**.
3. Optional hardening: for each package, choose **Settings → Publishing
   access → Require two-factor authentication and disallow tokens**. Trusted
   publishing keeps working after this.

You can only add a trusted publisher to a package that already exists on npm.
For a **new package**, a maintainer publishes the first version by hand
(`npm publish --access public` from a clean build, with 2FA) and then adds the
trusted publisher. Only after that do you add the package to the canary
changeset in `ci.yml`. Each package's `repository.url` must point at
`github.com/hypequery/hypequery`, or provenance is rejected.
`pnpm check:package-metadata` enforces this.

### Publish verification

After publishing, each job runs `scripts/release/verify-npm-publish.mjs` on the
versions it recorded before publishing. Those are:

- for canaries, every snapshot version;
- for stable releases, every version on `main` that npm lacked before the
  publish, plus changesets' `publishedPackages`.

For each version, `npm view <pkg>@<version> version` must resolve, and the
tarball must download and match `dist.integrity`. The script retries for up to
5 minutes to allow for registry and CDN lag, then fails the job.

The stable list also catches a stable version whose earlier publish failed.
changesets/action doesn't retry such a version while other changesets are
queued, so without this check it would stay missing.

### Failure alerts

When a publish job fails on `main`, its last step opens a GitHub issue labelled
`release-failure`, or comments on the one already open. The report lists the
versions that don't resolve on npm and links the run. The daily **Release
health** workflow (`.github/workflows/release-health.yml`) reports on the same
issue when the `@hypequery/datasets` `canary` dist-tag is more than 3 days older
than the newest `main` commit that touched a published package. Run it by hand
from the Actions tab at any time.

Triage:

- **`ENEEDAUTH`, or `E404` on `PUT`:** the package has no trusted publisher, or
  its settings don't match `hypequery` / `hypequery` / `ci.yml`. The workflow
  file may also have been renamed.
- **`E422` mentioning provenance or the repository:** the package's
  `repository.url` doesn't match the repository.
- **npm older than 11.5.1:** check the "Install an npm that supports trusted
  publishing" step.
- **Verification timed out but the publish succeeded:** rerun the job. Versions
  already on npm are skipped.

Rerunning a failed job runs it on the same commit. For a stable release, rerun
the `release` job from the run that merged `chore: release`, because no
changesets are queued at that commit. Close the issue once publishing is green.

### Public API reports

`@hypequery/protocol`, `@hypequery/datasets` and `@hypequery/deployment` have
committed API Extractor reports in `packages/<pkg>/api-report/`, one per
`exports` entry point. The `build` job runs `pnpm api:check`. If you change
their public types, run `pnpm turbo run build --filter='@hypequery/*'` and then
`pnpm api:report`. Commit the reports with a changeset that declares
`Consumer-breaking:` (see `CLAUDE.md`). The `release-tooling` job blocks a PR
that changes a report without that declaration.

## Python SDK and CLI

Python uses its own version, Towncrier fragments and PyPI release workflow. npm
Changesets do not version Python. See the
[Python release guide](python/hypequery/RELEASING.md), including its integrated
beta checklist and npm prerequisites. Python tag pushes publish only after the
exact-commit verification graph passes. Manual rehearsals build artifacts only.
