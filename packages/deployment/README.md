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

## Filesystem store

`createFileSystemDeploymentSubmissionStore` is the reference durable store for
a single host. It copies verified bundle bytes out of temporary intake storage,
revalidates the copy, and atomically publishes the release only after its bundle
is durable. Replaying the same release returns `already-exists` after the stored
state has been fully revalidated.

```ts
import {
  createDeploymentIntake,
  createFileSystemDeploymentSubmissionStore,
} from '@hypequery/deployment';

const store = createFileSystemDeploymentSubmissionStore({
  directory: '/var/lib/hypequery/deployments',
});

const intake = createDeploymentIntake({
  authenticator,
  authorizer,
  store,
});
```

The closed layout is content-addressed:

```text
<directory>/
  bundles/<bundle identity>/...
  releases/<release identity>/release.json
```

Bundle directories are published before release directories. A crash can leave
an unreferenced bundle that a later submission safely reuses, but cannot expose
a release whose bundle is incomplete. Files and directories are opened without
following symbolic links where Node exposes that facility, file contents and
directory entries are revalidated on reads and replays, and temporary staging
directories are removed after success or failure.

The configured directory is an operator-controlled local trust boundary. This
store does not provide remote replication, activation, lifecycle state, or
protection from an administrator modifying its files. `read(releaseIdentity)`
returns only a completely revalidated stored submission.

## Activation registry

`createFileSystemDeploymentActivationRegistry` adds explicit target activation
without changing accepted release or bundle bytes. The registry requires a
release reader that completely revalidates an accepted release and its closed
bundle before returning it; the filesystem submission store satisfies that
contract directly.

```ts
import {
  createFileSystemDeploymentActivationRegistry,
  createFileSystemDeploymentSubmissionStore,
} from '@hypequery/deployment';

const directory = '/var/lib/hypequery/deployments';
const releases = createFileSystemDeploymentSubmissionStore({ directory });
const activations = createFileSystemDeploymentActivationRegistry({
  directory,
  releases,
});

const target = { project: 'analytics', environment: 'production' };
const current = await activations.current(target);
const result = await activations.activate({
  target,
  releaseIdentity,
  expectedRevision: current?.revision ?? null,
});
```

`expectedRevision` is a compare-and-swap precondition. A different active
revision returns `conflict`; requesting the release that is already active
returns `already-active`. Activating an older accepted release performs a
rollback through the same operation and produces a new revision, so stale
pre-rollback callers cannot pass the comparison after an ABA sequence.

The filesystem implementation stores an immutable, domain-separated activation
record for every transition and derives the current release by verifying the
append-only chain. It has no mutable pointer file or persistent lock to become
stale after a crash. Activation does not load runtime code, route traffic,
perform health checks, or authorize callers; those remain provider concerns.

The package is ESM-only and requires Node.js 20 or newer.
