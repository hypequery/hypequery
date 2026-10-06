# Python release notes

Add each pending Python change to a separate Markdown file in this directory
(for example `pr-612.md`), rather than editing the top of `CHANGELOG.md`.
Use ordinary changelog bullets describing the user-visible behavior. Keep one
file per PR so independent branches and stacked PRs merge without sharing a
changelog insertion point. TypeScript packages continue to use Changesets.

At a Python release, after its feature PRs have merged, move the released
fragments into the appropriate section of `../CHANGELOG.md` and remove only
those fragments. Preserve release history and leave unreleased fragments here.
Do not consolidate fragments independently on feature branches.
