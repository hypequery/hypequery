# Changesets

This folder stores release intent for the monorepo. When you run `pnpm run changeset`, the CLI will prompt you to pick the packages being updated and describe the change. Each entry becomes a Markdown file in this directory until you run `pnpm run release:version`, which consumes the entries, bumps the selected package versions, and writes changelog entries.

A typical release flow now looks like this:

1. `pnpm run changeset` – record every set of changes (choose the packages and bump type).
2. Commit the generated `.changeset/*.md` file(s) alongside your code changes and merge through the usual PR process.
3. When you're ready to cut a release, execute `pnpm run release:version` on the `main` branch to apply the queued version bumps, then `pnpm install --no-frozen-lockfile` so lockfiles stay in sync.
4. Finally, publish with `pnpm run release:publish` (this shells out to `changeset publish`, which runs `pnpm publish` for each package that changed).

For the very first publish of a package, you can skip step 1/3 if the version in `package.json` is already what you want to ship. `changeset publish` will just push the current version to npm as long as that version hasn't been published before.
