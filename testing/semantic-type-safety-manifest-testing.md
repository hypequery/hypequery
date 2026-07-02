# Semantic Type Safety And Manifest DX Testing

This checklist verifies the semantic typing and static manifest changes in PR #245.
It is meant for local review and CI confidence, not for the broader live ClickHouse
manual specs.

## Scope

- `@hypequery/datasets` projection-aware result types.
- `@hypequery/serve` `InferApiType` / `InferAPIType` semantic metadata.
- `@hypequery/react` `createAnalyticsHooks` name and projection inference.
- `@hypequery/cli` static `generate:manifest` command.
- Turbo invalidation for package type tests.

## Required Commands

Run these from the repository root:

```bash
pnpm --filter @hypequery/datasets test
pnpm --filter @hypequery/serve test
pnpm --filter @hypequery/react test
pnpm --filter @hypequery/cli test
pnpm lint
pnpm test
```

Expected result:

- All commands exit `0`.
- The root `pnpm test` run includes package type tests, not only runtime tests.
- At the time this checklist was written, root `pnpm test` reported
  `Tasks: 14 successful, 14 total` with 1,506 passing tests and 1 skipped test.

## Type-Test Coverage To Inspect

Review these files before relying on the test run:

- `packages/datasets/type-tests/projection-types.test-d.ts`
- `packages/react/type-tests/semantic-infer.test-d.ts`
- `packages/serve/type-tests/semantic-hooks.test-d.ts`

They should cover:

- Dataset projection rows expose selected dimensions and selected measures.
- Dataset queries with omitted `dimensions` do not expose dimension fields.
- Dataset queries with omitted `measures` expose all measures.
- `by` adds `period`; no `by` means no `period`.
- Metric queries expose the metric value plus selected dimensions.
- Unknown metric and dataset names are type errors with plain
  `InferApiType<typeof api>`.
- `useMetric()` and `useDataset()` infer result rows from literal input objects.

## Negative Type-Test Sanity Check

To prove type-test-only edits are caught by the root test pipeline, temporarily add a
bad assertion to one type-test file, then run `pnpm test`.

Example temporary edit:

```ts
// packages/datasets/type-tests/projection-types.test-d.ts
expectTypeOf(selectedOnly.data[0].status).toEqualTypeOf<string>();
```

Expected result:

- `pnpm test` fails.
- The failure points at the relevant `*.test-d.ts` file.
- After removing the temporary bad assertion, `pnpm test` passes again.

Do not commit the temporary failing assertion.

## CLI Manifest Checks

Run the CLI package tests:

```bash
pnpm --filter @hypequery/cli test
```

Verify the tests exercise:

- `hypequery generate:manifest <api-module> --output <json-file>`.
- The command writes the exact serializable `api.manifest()` JSON.
- Semantic keys such as `dataset:orders` are preserved in the output.
- A module without an exported API/manifest fails with a clear error.

For an additional manual smoke test, use any local API module that exports an `api`
with `manifest()`:

```bash
pnpm --filter @hypequery/cli build
node packages/cli/dist/bin/cli.js generate:manifest analytics/api.ts --output analytics/hypequery-manifest.json
```

Expected result:

- The output file is valid JSON.
- Its contents match the runtime result of `api.manifest()`.
- It can be imported by a Next/client hook module as data.

## Next.js Usage Check

Confirm the docs describe the recommended static manifest pattern:

- Server route imports `api` and `createFetchHandler`.
- Client hook module imports `type Api = InferApiType<typeof api>` type-only.
- Client hook module imports the generated manifest JSON as runtime data.
- Hooks are created with:

```ts
createAnalyticsHooks<Api>({
  baseUrl: '/api/analytics',
  manifest,
});
```

This should avoid importing server code into the client bundle and avoid a runtime
manifest/config fetch.

## Turbo/CI Check

Inspect `turbo.json` and confirm the `test` task inputs include:

- `tsconfig*.json`
- `src/**/*.d.ts`
- `type-tests/**/*.ts`
- `type-tests/**/*.tsx`
- `type-tests/**/*.d.ts`

This is what makes type-test changes invalidate cached `pnpm test` results in CI.
