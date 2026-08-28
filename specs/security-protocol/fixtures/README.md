# Conformance fixture update runbook

This directory is the language-neutral conformance source of truth. A fixture
change is a protocol change, not an implementation-specific test edit.

## Before editing

1. Identify the RFC and extension version that owns the behavior. Accepted
   grammar, limits, comparison rules, or canonical bytes cannot be changed in
   place; introduce a new extension version when the RFC requires one.
2. Decide whether the case is a success, rejection, identity, portability, or
   deterministic fuzz case. Rejection cases must use the stable code owned by
   their manifest family.
3. Keep fixture IDs unique and inputs deterministic. Never put credentials,
   customer data, nondeterministic timestamps, or host-specific paths in the
   corpus.

## Update workflow

1. Edit the owning family files and its README. Add new files or fuzz targets
   to `manifest.json`; do not bypass the manifest.
2. Update the TypeScript reference implementation and every implementation
   that already announces the family. A family may be implemented in a later
   stacked PR, but no release gate may silently drop an announced family.
3. When an adapter gains a family, update its exact `--expect-families` list in
   the same PR. For Python, that list is owned by `conformance:python` in the
   root `package.json`.
4. Add a Changeset whenever the bundled `@hypequery/protocol-conformance`
   fixture snapshot or runner behavior changes.
5. Rebuild the conformance package after fixture edits; its build copies the
   current corpus into the published package.

## Verification

From the repository root:

```console
pnpm --filter @hypequery/protocol build
pnpm --filter @hypequery/datasets build
pnpm --filter @hypequery/protocol-conformance build
pnpm --filter @hypequery/protocol-conformance test
pnpm conformance
uv run --project python/hypequery --frozen pytest
```

Review the report's implementation, announced families, hostile-object suite,
and not-run count—not only its exit status. CI release gates must use an exact
family assertion for partial adapters.
