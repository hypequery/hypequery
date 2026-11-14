# Cloud API operations spec

`operations-v1.json` describes every hypequery Cloud operation served under
`/v1`: name, scope, capability, whether it is destructive, the HTTP route, the
input and output JSON Schemas, and the error codes it can return, plus the
error catalog (status, category, retryable, hint, docs URL).

**This is a copy. The source is the hypequery Cloud repository**, where the
file is generated from the operation registry
(`apps/web/src/lib/operations/spec.ts`). Don't edit it here; update it from
Cloud instead.

`@hypequery/cloud-client` (`packages/cloud-client`) is generated from this
file.

## Updating

Check whether this copy has drifted from a Cloud spec (a path or a URL):

```bash
pnpm --filter @hypequery/cloud-client spec:check /path/to/hypequery-cloud/specs/cloud-api/operations-v1.json
```

It exits non-zero and lists the added, removed and changed operations when the
two differ. To take Cloud's version and regenerate the client in one step:

```bash
pnpm --filter @hypequery/cloud-client spec:update /path/to/hypequery-cloud/specs/cloud-api/operations-v1.json
```

Then add a changeset for `@hypequery/cloud-client`.
