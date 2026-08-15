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
