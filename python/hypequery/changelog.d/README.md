# Python release notes

Add pending Python changes to a separate Markdown file here, for example
`pr-612.md`. Use ordinary changelog bullets describing user-visible behavior;
multiple bullets and continuation lines are supported. Keep one file per PR
so feature branches do not share a changelog insertion point. TypeScript
packages continue to use Changesets.

Towncrier is configured with a custom `md` fragment type to preserve this
existing naming convention. `README.md` and `template.md` are excluded from
release notes. Unknown file formats fail validation rather than being silently
ignored. `legacy-unreleased.md` preserves the notes that predated this setup.

Preview the next release from `python/hypequery`:

```bash
uv run towncrier build --draft --version 0.1.0b1
```

To prepare a release, run **Prepare Python release** on `main` and enter the
target version. It opens or refreshes a release PR with the package version,
lockfile, dated changelog and included fragment deletions. Review its CI and
release notes before merging, then push the matching `python-v…` tag to publish.
Do not consolidate fragments independently on feature branches.

See [the release guide](../RELEASING.md) for setup and local preparation.
