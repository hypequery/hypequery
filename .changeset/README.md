# Changesets

Changesets turn package changes into version bumps and changelog entries.

```bash
# Record release intent with the code change
pnpm changeset

# Apply queued versions and changelogs on main
pnpm release:version

# Publish changed packages
pnpm release:publish
```

Commit the generated `.changeset/*.md` file with the change it describes. Choose the smallest correct SemVer bump for every affected package.

For a package’s first release, `changeset publish` can publish the version already present in `package.json` even when no changeset has been consumed.

## Consumer-breaking changes

A changeset whose package's public API report changed needs a
`Consumer-breaking:` line (decision 0030; see `CLAUDE.md`, "Public API
reports"). Under [RFC 0030](../specs/security-protocol/rfc/0030-deployment-target-capability-advertisement.md#5-compatibility-policy),
a change that makes existing content produce a higher artifact version, such
as a new feature that forces deployment contract 3, carries the line too, even
when no API report changes.
