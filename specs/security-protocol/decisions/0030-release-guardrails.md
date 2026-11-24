# Decision 0030: Release guardrails

- Status: Accepted
- Date: 2026-11-22
- Owners: Hypequery maintainers

## Context

Two release failures reached downstream consumers before anyone in this repo
noticed them.

- **Publishing stopped without an alert.** The long-lived `NPM_TOKEN` secret
  expired. From 19 to 22 November 2026 every canary and stable publish failed
  with `E404` on `PUT`. The failed runs went unnoticed, and hypequery Cloud fell
  behind on its pinned versions.
- **Public types broke consumers without warning.**
  - RFC 0028 widened `ProtocolDatasetContract.source` from `string` to a union,
    which caused 50 compile errors in Cloud.
  - Contract 3 renamed `filters` to `allowedFilters`.

  This repo's own checks passed in both cases, because nothing recorded the
  public type surface.

## Decision

1. **npm trusted publishing (OIDC).**
   - The `canary-release` and `release` jobs in `ci.yml` have `id-token: write`
     and install npm 11.5.1 or later.
   - They publish without a token, with provenance. Trusted publishing generates
     provenance automatically, and `NPM_CONFIG_PROVENANCE` makes that explicit.
   - Each package trusts `hypequery/hypequery` + `ci.yml` on npmjs.com.
   - `NPM_TOKEN` is not kept as a fallback. npm doesn't need it for trusted
     publishing, and a token that can expire is the failure this decision
     removes.
   - Setup steps: `release-commands.md`.
2. **Every publish is verified.**
   - Before publishing, the job records the versions it will publish.
   - Afterwards, each version must resolve with `npm view`, and its tarball must
     download and match `dist.integrity`. The check retries for up to 15 minutes
     for CDN lag, and then the job fails.
   - The stable job also verifies versions on `main` that npm lacks.
     changesets/action doesn't retry those while changesets are queued.
3. **A failure is reported.**
   - When a publish job fails on `main`, the `release-failure-alert` job opens
     the `release-failure` issue, or comments on the open one, with the missing
     versions and the run link. It uses `GITHUB_TOKEN` with `issues: write`.
   - Reports are serialized by one concurrency group shared with the daily
     check.
   - If two runs still create an issue each, the newer issue is closed and its
     report moves to the oldest.
   - Every check runs within the 5-minute budget: `npm view` is killed and the
     tarball download is aborted when the budget ends, so the alert is never
     delayed.
4. **Canary staleness is checked daily.**
   - `release-health.yml` compares the `@hypequery/datasets` `canary` dist-tag
     with the newest `main` commit that touched a published package. It reports
     on the same issue when the canary is more than 3 days behind.
   - This catches outages the per-job alert can't see, such as publish jobs
     skipped because `build` keeps failing.
5. **Public API reports.**
   - Each `exports` entry point of `@hypequery/protocol`, `@hypequery/datasets`
     and `@hypequery/deployment` has a committed API Extractor report.
   - `pnpm api:check` in the `build` job fails when the built declarations no
     longer match.
   - A PR that changes an existing report needs a changeset for that package
     with a `Consumer-breaking:` line: `no`, or what breaks plus a migration
     note. The `release-tooling` job enforces it, and the line reaches the
     changelog.

API Extractor was chosen over diffing `tsc --declaration` output because it
reports only what each entry point reaches, with types in a stable order.
Internal declaration files that change on every refactor would make a raw
`.d.ts` diff noisy, and people learn to ignore a noisy check.

It runs on the existing `dist/` output, in about 20 seconds for six entry
points. Its bundled TypeScript matches the repo's, 6.0.

`includeForgottenExports` inlines types that the API references but doesn't
export, so changes to those types show in the report too.

## Consequences

- A maintainer must configure 11 trusted publishers on npmjs.com before the
  OIDC change merges. The first canary on `main` must run within 2 days of that
  setup.
- A new package's first version is published by hand. Its trusted publisher
  can be added only after that.
- Changing public types now means also regenerating a report and writing a
  `Consumer-breaking:` line. That cost is intended.
- If publishing is blocked, the alert says so within one push. If it is
  skipped, the daily check says so within 3 days.
