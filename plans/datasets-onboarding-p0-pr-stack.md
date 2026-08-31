# Datasets Onboarding P0 PR Stack

Date: 2026-08-29 (updated 2026-08-31)
Status: PRs #428 and #429 merged; PR #430 open against `main`
Scope: The three P0 items from the datasets onboarding UX and DX review

## Outcome

This stack makes generated datasets safe to adopt and maintain:

1. Tenant isolation is never activated from a naming heuristic.
2. Semantic result values have one runtime and TypeScript contract.
3. Regeneration cannot silently overwrite user customizations.

## Stack and Merge Order

| Order | PR | Branch | Status |
| --- | --- | --- | --- |
| 1 | [#428 — Require explicit dataset tenant isolation](https://github.com/hypequery/hypequery/pull/428) | `codex/datasets-onboarding-tenant-safety` | Merged as `61954e4a`, released in `@hypequery/cli@1.18.1` |
| 2 | [#429 — Normalize semantic result values](https://github.com/hypequery/hypequery/pull/429) | `codex/datasets-onboarding-result-contract` | Merged as `6c1bcb63`, released in `@hypequery/datasets@0.13.6` |
| 3 | [#430 — Protect dataset regeneration](https://github.com/hypequery/hypequery/pull/430) | `codex/datasets-onboarding-safe-regeneration` | Open, based on `main` |

PRs #428 and #429 were squash-merged and released, so their changesets were
consumed on `main` and no longer live in this branch. PR #430 now carries only
the safe-regeneration change and its own changeset.

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
- Adds `--force` for explicit atomic replacement that preserves, and never
  loosens, the destination's permissions.
- Adds non-writing `--check` for CI drift detection.
- Adds non-writing `--diff` for reviewing generated changes.
- Avoids rewriting files whose generated contents are already current.
- Tests command modes, atomic file replacement, and diff formatting.
- Documents the regeneration workflow and includes a patch changeset for
  `@hypequery/cli`.

Acceptance criteria:

- Default regeneration cannot overwrite customized definitions.
- Forced writes replace the file atomically, and a permission change that lands
  while the replacement is written is not undone by a stale snapshot.
- CI can detect missing or stale generated definitions without mutation.
- Users can inspect schema-driven changes before accepting them.

## Validation Snapshot

The following local checks passed after merging `main` into PR #430:

- Full `@hypequery/cli` suite: 587 passed, 1 skipped.
- Dataset, Serve, and React semantic type tests.
- Dependency-aware builds for the CLI, datasets, Serve, and React packages.
- CLI lint check.

The ClickHouse integration expectations updated by PR #429 were not run locally
because the Docker daemon was unavailable; that suite shipped with #429 and is
covered by CI.

## Release Notes

Each PR has its own changeset so it can be reviewed and released independently.
The stack intentionally limits itself to the three P0 onboarding issues; later
DX enhancements and post-setup feature gaps should be tracked separately rather
than added to these PRs.
