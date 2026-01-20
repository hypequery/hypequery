# hypequery Release Commands

## Upcoming Changesets Workflow
We're migrating to [Changesets](https://github.com/changesets/changesets) for release automation. Until the new workflow is finalized, releases should be coordinated manually.

### Temporary manual steps
1. Ensure `main` is green (tests/lint/build).
2. Generate a Changeset once the tooling lands:
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
- Coordinate with the team before tagging a release while the tooling is in flux.
- Always ensure tests pass before cutting a release.
- Update this document again once the Changesets automation is fully wired up.
