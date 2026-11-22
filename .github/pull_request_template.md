## Summary

<!-- What changes and why. -->

## Checklist

- [ ] A user-facing change to a published package has a changeset (`pnpm changeset`).
- [ ] If public types of `@hypequery/protocol`, `@hypequery/datasets` or `@hypequery/deployment` changed, I ran `pnpm api:report` after building and committed `packages/<pkg>/api-report/`.
- [ ] If an API report changed, that package's changeset has a `Consumer-breaking:` line: either `no` (additive only) or what breaks plus a migration note for consumers.
