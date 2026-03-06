# hypequery Release Commands

## Canary Releases
Every push to `main` now publishes canary builds for `packages/clickhouse`, `packages/serve`, and `packages/cli`.

- Canary publishes use the npm `canary` dist-tag.
- Canary versioning uses Changesets snapshot releases.
- The GitHub Actions canary job creates a temporary changeset, snapshots the three publishable packages, publishes them, then restores the workspace files.
- Stable versioning remains Changesets-driven and unchanged.

## Stable Releases
Stable releases continue to use [Changesets](https://github.com/changesets/changesets).

### Manual steps when needed
1. Ensure `main` is green (tests/lint/build).
2. Generate a changeset for any stable release:
   ```bash
   pnpm changeset
   ```
3. Version and publish when ready:
   ```bash
   pnpm changeset version
   pnpm install --no-frozen-lockfile
   pnpm changeset publish
   ```

## Important Notes
- Canary publishing does not replace changesets for stable releases.
- Always ensure tests pass before cutting a release.
