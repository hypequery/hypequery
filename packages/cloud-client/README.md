# @hypequery/cloud-client

A typed client for hypequery Cloud's `/v1` operations: one method per
operation the dashboard can do, with input and output types, generated from
Cloud's operations spec.

```bash
npm install @hypequery/cloud-client
```

```ts
import { CloudApiError, createCloudClient } from '@hypequery/cloud-client';

const cloud = createCloudClient({
  token: process.env.HYPEQUERY_API_TOKEN!, // a management token, hqmt_v1_...
  // baseUrl: 'https://cloud.hypequery.com' (default)
});

const { projects } = await cloud.projects.list();
const drafts = await cloud.drafts.list({ project: 'shop' });

// Destructive operations need confirm: true, in the type and on the server.
await cloud.drafts.delete({ project: 'shop', draft: id, confirm: true });

// Or by name:
await cloud.call('releases.status', { project: 'shop' });
```

## Requests

- Each method is `resource.verb` from the spec (`client.drafts.applyUpdate`).
  Its JSDoc gives the route, scope, capability and the error codes it returns.
- Path parameters (`{project}` is the project slug) are taken from the input.
  GET and DELETE send the rest of the input as the query string; other methods
  send it as a JSON body.
- `token` is sent as `Authorization: Bearer <token>`. Pass a function to
  supply a fresh token per request.
- `fetch`, `headers` and per-call `{ signal, headers }` are optional.

## Errors

Every failure is a `CloudApiError` carrying Cloud's error envelope:

```ts
try {
  await cloud.releases.rollback({ project, version, expectedRevision, confirm: true });
} catch (error) {
  if (error instanceof CloudApiError) {
    error.code;        // 'RELEASE_MOVED', ... (CloudErrorCode)
    error.hint;        // the next action, in one sentence
    error.retryable;   // retrying the same request may succeed
    error.correctable; // fix the input (error.issues) and retry
    error.requestId;   // quote this to support
  }
}
```

When there is no envelope to read, the client uses `NETWORK_ERROR`
(retryable) or `UNEXPECTED_RESPONSE`. An aborted call rethrows the abort
error unchanged. `CLOUD_ERRORS` is the full catalog (status, category,
retryable, hint, docsUrl) and `OPERATIONS` lists every route.

## Where the types come from

The spec's source is the hypequery Cloud repository. This repository keeps a
copy at [`specs/cloud-api/operations-v1.json`](../../specs/cloud-api/README.md),
and `src/generated/operations.ts` is generated from it and committed.

```bash
pnpm --filter @hypequery/cloud-client spec:check <path-or-url>   # has Cloud's spec drifted from ours?
pnpm --filter @hypequery/cloud-client spec:update <path-or-url>  # take Cloud's copy and regenerate
pnpm --filter @hypequery/cloud-client generate                   # regenerate from our copy
```

A unit test fails if the generated file is out of date with the spec.
