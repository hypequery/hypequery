# @hypequery/deployment

Provider-neutral verification and receiving-side intake for Hypequery deployment
bundles.

The package accepts the authenticated multipart transport emitted by
`hypequery deploy`, reconstructs only manifest-declared files in temporary
storage, and revalidates the release, bundle manifest, file hashes, deployment
identity, and runtime references before handing the submission to a store. It
does not activate or execute a release.

## Intake adapters

`createDeploymentIntake` is independent of an HTTP framework. Adapt an incoming
request into a case-insensitive header record and an `AsyncIterable<Uint8Array>`
body, then map the returned status, headers, and JSON body onto the framework's
response.

Three provider-owned adapters are required:

- `DeploymentAuthenticator` validates the bearer token before request bytes are
  consumed;
- `DeploymentAuthorizer` authorizes the canonical project and environment once
  the release envelope has been validated;
- `DeploymentSubmissionStore` atomically persists or recognizes the fully
  verified release identity.

The store receives a verified bundle whose directory is temporary. It must copy
or persist every required byte before `accept` resolves. Returning
`already-exists` is valid only for an authorized replay of the same deterministic
release identity.

```ts
import { createDeploymentIntake } from '@hypequery/deployment';

const intake = createDeploymentIntake({
  authenticator: {
    async authenticate({ token }) {
      return authenticateToken(token);
    },
  },
  authorizer: {
    async authorize({ principal, target }) {
      return canDeploy(principal, target.project, target.environment);
    },
  },
  store: {
    async accept(submission) {
      return persistVerifiedSubmission(submission);
    },
  },
});
```

New submissions return HTTP status `202` and `status: "accepted"`; verified
idempotent replays return HTTP status `200` and `status: "already-exists"`.
Malformed, unauthorized, oversized, or inconsistent submissions fail closed
with a bounded JSON error response. Temporary upload data is removed on success
and failure.

## Bundle verification

`verifyDeploymentBundle(directory)` verifies a closed bundle directly from the
filesystem. It rejects symbolic links and undeclared entries, enforces byte
limits, recomputes every hash and identity, and returns an immutable verified
snapshot.

The package is ESM-only and requires Node.js 20 or newer.
