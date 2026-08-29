# Datasets Onboarding P0 PR Stack

Date: 2026-08-29
Status: Open for review
Scope: The three P0 items from the datasets onboarding UX and DX review

## Outcome

This stack makes generated datasets safe to adopt and maintain:

1. Tenant isolation is never activated from a naming heuristic.
2. Semantic result values have one runtime and TypeScript contract.
3. Regeneration cannot silently overwrite user customizations.

## Stack and Merge Order

| Order | PR | Branch | Base | Commit |
| --- | --- | --- | --- | --- |
| 1 | [#428 — Require explicit dataset tenant isolation](https://github.com/hypequery/hypequery/pull/428) | `codex/datasets-onboarding-tenant-safety` | `main` | `f70ad6b1` |
| 2 | [#429 — Normalize semantic result values](https://github.com/hypequery/hypequery/pull/429) | `codex/datasets-onboarding-result-contract` | PR #428 branch | `265f5810` |
| 3 | [#430 — Protect dataset regeneration](https://github.com/hypequery/hypequery/pull/430) | `codex/datasets-onboarding-safe-regeneration` | PR #429 branch | `56ffa057` |

Merge the PRs in this order. After each parent merges, retarget the next PR to
`main` if GitHub does not do so automatically, and confirm that its diff still
contains only its intended commit or commits.

## P0-1: Explicit Tenant Isolation

Problem: `generate:datasets` inferred `tenantKey` from names such as
`tenant_id`, `organization_id`, and `customer_id`. That turned an uncertain
schema heuristic into an active security policy and could also produce a
dataset that fails until trusted runtime tenant scope is configured.

PR #428:

- Stops the generator from emitting active `tenantKey` configuration.
- Leaves a review-only comment beside likely candidates.
- Surfaces the same candidates as CLI warnings from both standalone generation
  and `init`.
- Documents the explicit tenant setup requirement.
- Includes a patch changeset for `@hypequery/cli`.

Acceptance criteria:

- A candidate column never activates tenant enforcement automatically.
- Users can see which column should be reviewed.
- Existing explicit `tenantKey` authoring remains unchanged.

## P0-2: Stable Semantic Result Contract

Problem: public result types described measures and metrics as strings, while
the query-builder path could return numbers for ClickHouse aggregate types.
Nullable statistical aggregates could also return `null`, which the types did
not admit.

PR #429 defines the wire contract as `string | null`:

- Every non-null measure or metric value is normalized to a string.
- SQL `NULL` remains `null`.
- Builder, derived-metric, in-memory, and custom-backend client paths share the
  normalization boundary.
- Dataset, Serve, and React projection-aware types expose `string | null`.
- Unit, cache, type, documentation, and ClickHouse integration expectations are
  aligned with the contract.
- Includes patch changesets for `@hypequery/datasets`, `@hypequery/serve`, and
  `@hypequery/react`.

Acceptance criteria:

- Runtime values agree with the exported TypeScript types.
- Execution backend choice does not change the public measure representation.
- Null aggregate results are preserved rather than stringified.

## P0-3: Safe Dataset Regeneration

Problem: rerunning `generate:datasets` wrote directly over the destination,
which could destroy hand-customized dimensions, measures, relationships, or
security configuration.

PR #430:

- Renders definitions before touching the destination.
- Creates missing files but refuses to replace changed existing files by
  default.
- Adds `--force` for explicit atomic replacement.
- Adds non-writing `--check` for CI drift detection.
- Adds non-writing `--diff` for reviewing generated changes.
- Avoids rewriting files whose generated contents are already current.
- Tests command modes, atomic file replacement, and diff formatting.
- Documents the regeneration workflow and includes a patch changeset for
  `@hypequery/cli`.

Acceptance criteria:

- Default regeneration cannot overwrite customized definitions.
- Forced writes replace the file atomically.
- CI can detect missing or stale generated definitions without mutation.
- Users can inspect schema-driven changes before accepting them.

## Validation Snapshot

The following local checks passed while creating the stack:

- Full `@hypequery/cli` suite: 573 passed, 1 skipped.
- `@hypequery/datasets` unit suite: 307 passed.
- `@hypequery/react` suite: 51 passed.
- Dataset, Serve, and React semantic type tests.
- Dependency-aware builds for the CLI, datasets, Serve, and React packages.
- CLI, datasets, and React lint checks.
- `git diff --check` for each stack branch.

The ClickHouse integration expectations were updated, but that suite was not
run locally because the Docker daemon was unavailable. It remains a required CI
or Docker-capable local check before merging PR #429.

## Release Notes

Each PR has its own changeset so it can be reviewed and released independently.
The stack intentionally limits itself to the three P0 onboarding issues; later
DX enhancements and post-setup feature gaps should be tracked separately rather
than added to these PRs.
