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

A changeset that can break a downstream consumer such as hypequery Cloud
carries a line beginning `Consumer-breaking:` that names what the consumer or
deployment target must change. Use it, even in a minor or patch, when a change:

- widens a public type, for example a return type becoming a union of
  contract versions, or a union gaining a member;
- renames a public field, type or export; or
- makes content that used to produce one artifact version produce a higher
  one, such as a new feature that forces deployment contract 3.

See [RFC 0030](../specs/security-protocol/rfc/0030-deployment-target-capability-advertisement.md#5-compatibility-policy).
