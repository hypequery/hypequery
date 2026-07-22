---
name: release
description: Cut a stable hypequery release via Changesets, or explain/check the canary flow. Use when asked to release, publish, version packages, cut a release, or add a changeset.
---

# hypequery release

Two release channels — make sure you're on the right one before doing anything:

- **Canary**: automatic. Every push to `main` publishes snapshot builds of `@hypequery/clickhouse`, `@hypequery/serve`, and `@hypequery/cli` to the npm `canary` dist-tag via GitHub Actions. There are **no manual canary steps** — if the user asks to "publish a canary," the answer is to merge to main and watch the Actions run (`gh run list`).
- **Stable**: manual, Changesets-driven. The steps below.

## Adding a changeset (during feature work)

Any user-facing change to a published package needs a changeset in the PR:

```bash
pnpm changeset
```

Pick the affected packages and semver bump. Patch for fixes, minor for features. **Never pick major** without explicit user confirmation — majors are planned events in this repo (see the deprecation policy in CLAUDE.md: shipped exports are `@deprecated`, not removed, until a planned major).

## Cutting a stable release

1. **Preflight — main must be green.** From an up-to-date `main` checkout:
   ```bash
   pnpm build && pnpm test && pnpm lint
   ```
   If anything fails, stop and report. Do not release over a red build.
2. Version and update the lockfile:
   ```bash
   pnpm release:version   # changeset version + pnpm install --lockfile-only --no-frozen-lockfile
   ```
3. Review the result before publishing: check the bumped versions in each `packages/*/package.json` and the generated `CHANGELOG.md` entries look right. Show the user a summary and **get explicit confirmation before publishing** — publish is irreversible.
4. Publish:
   ```bash
   pnpm release:publish
   ```
5. Commit the version bumps and push (releases usually land via a `chore: release` PR — follow the pattern in `git log --oneline --grep 'chore: release'`).

## Sanity checks after publish

- `npm view @hypequery/<pkg> version` matches the new version.
- `npm view @hypequery/<pkg> dist-tags` — stable went to `latest`, not `canary`.

Reference: `release-commands.md` at the repo root is the human-maintained source of truth; if it disagrees with this skill, trust it and flag the drift.
