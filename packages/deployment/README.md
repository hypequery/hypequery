# @hypequery/deployment

Provider-neutral verification, intake, activation, runtime, and HTTP hosting
building blocks for Hypequery deployment bundles.

The package accepts the authenticated multipart transport emitted by
`hypequery deploy`, reconstructs only manifest-declared files in temporary
storage, and revalidates the release, bundle manifest, file hashes, deployment
identity, and runtime references before handing the submission to a store.

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

## HTTP control plane

`createDeploymentControlPlane` combines intake and activation behind closed v1
routes. Activation reads and writes use a separate target-scoped authorizer;
write authorization completes before the small JSON request body is consumed.
The Fetch and Node adapters preserve streaming multipart submission bodies.

```ts
import {
  createDeploymentControlPlane,
  createDeploymentControlPlaneNodeHandler,
} from '@hypequery/deployment';

const controlPlane = createDeploymentControlPlane({
  intake,
  activations,
  authenticator,
  authorizer: {
    async authorize({ principal, action, target }) {
      return canControlDeployment(principal, action, target);
    },
  },
});

const nodeHandler = createDeploymentControlPlaneNodeHandler(controlPlane);
```

The control plane exposes release submission, compare-and-swap activation,
current state, and bounded cursor history. It returns stable, bounded JSON error
codes and suppresses internal provider and filesystem details. The HTTP
contract is specified in `specs/deployment/0003-control-plane-http.md`.

## Runtime materialization

`createDeploymentRuntimeMaterializer` converts the current target activation
into a private runtime snapshot. It revalidates the accepted release and closed
bundle, copies and hashes each runtime artifact without following symbolic
links, and confirms the activation revision again before returning.

```ts
import { createDeploymentRuntimeMaterializer } from '@hypequery/deployment';

const materializer = createDeploymentRuntimeMaterializer({
  activations,
  releases: store,
});

const snapshot = await materializer.current({
  project: 'analytics',
  environment: 'production',
});
```

Artifact `read()` methods return fresh byte copies, so neither callers nor later
changes to durable storage can alter a materialized snapshot. Runtime imports,
process lifecycle, readiness, and traffic switching remain separate concerns.

## Runtime supervision

`createDeploymentRuntimeSupervisor` starts materialized snapshots through a
runtime factory, checks candidate readiness, confirms activation again, and
atomically changes the generation used for new named-query invocations. Failed
or superseded candidates never displace a healthy generation.

```ts
import {
  createDeploymentRuntimeSupervisor,
  createNodeWorkerDeploymentRuntimeFactory,
} from '@hypequery/deployment';

const supervisor = createDeploymentRuntimeSupervisor({
  materializer,
  factory: createNodeWorkerDeploymentRuntimeFactory(),
});

await supervisor.reconcile({ project: 'analytics', environment: 'production' });
const result = await supervisor.invoke({
  target: { project: 'analytics', environment: 'production' },
  query: 'orders',
  argument: { input, ctx: { tenantId } },
});
```

Calls already assigned to an old generation may finish after cutover. That
generation receives no new calls and closes when its in-flight work reaches
zero or the drain deadline expires. The reference Node factory loads exact
materialized bytes in worker threads and removes their temporary files on
shutdown. Provider factories can implement Python, process, container, or
remote-sandbox isolation behind the same lifecycle interface.

The reference worker is a lifecycle boundary, not a hostile-code security
sandbox. Only trusted deployment code should use it directly.

## Data-plane execution

`createDeploymentDataPlane` executes named-query routes from one validated,
immutable deployment contract. It applies bounded input defaults and unknown
property behavior, enforces access and tenant policy, dispatches the declared
implementation kind through an injected adapter, and validates output before
returning it.

```ts
import {
  createDeploymentDataPlane,
  createDeploymentRuntimeSupervisorExecutor,
} from '@hypequery/deployment';

const executeRuntimeReference = createDeploymentRuntimeSupervisorExecutor({
  supervisor,
  target,
  activationRevision: snapshot.activation.revision,
  argument: ({ input, principal, tenant }) => ({ input, principal, tenant }),
});

const dataPlane = createDeploymentDataPlane({
  deployment: snapshot.deployment,
  authenticate,
  resolveTenant,
  executeSemanticPlan,
  executeCompiledSql,
  executeRuntimeReference,
});

const result = await dataPlane.execute({
  method: 'POST',
  path: '/analytics/queries/orders',
  credentials,
  input: { status: 'paid' },
});
```

The runtime-supervisor adapter requires the exact activation revision used to
construct the data plane. A later activation therefore cannot accidentally run
against stale route or schema metadata. Argument mapping remains explicit so a
host can preserve the handler contract of its chosen runtime.

Semantic-plan and compiled-SQL adapters own database execution. The core passes
only validated values, the fixed implementation artifact, and closed typed SQL
parameter bindings; it does not select credentials or interpolate SQL.

## Data-plane hosting

`createDeploymentHost` keeps route/schema execution and supervised runtime
dispatch pinned to the same activation revision. Reconciliation builds a new
data plane from the supervisor's immutable generation view and publishes it
only after confirming that the active generation did not change during
configuration.

`createDeploymentDataPlaneFetchHandler` and
`createDeploymentDataPlaneNodeHandler` expose a hosted data plane over HTTP.
They accept either query parameters or one bounded UTF-8 JSON body, reject
duplicate JSON property names, forward cancellation, and return bounded JSON
errors. Public cache metadata is emitted only when execution confirms the
request was public, tenant-independent, and unauthenticated.

For a single-node service, `createFileSystemDeploymentHost` composes the
filesystem submission store, activation registry, intake, control plane,
runtime materializer, supervisor, and generation-pinned data plane. It
reconciles configured targets at startup and schedules reconciliation after a
durable activation without changing an already-successful activation response
if runtime startup later fails.

```ts
import {
  createDeploymentDataPlaneNodeHandler,
  createFileSystemDeploymentHost,
} from '@hypequery/deployment';

const service = createFileSystemDeploymentHost({
  directory: '/var/lib/hypequery/deployments',
  targets: [{ project: 'analytics', environment: 'production' }],
  intake: { authenticator: deploymentAuthenticator, authorizer: deploymentAuthorizer },
  controlPlane: { authenticator: operatorAuthenticator, authorizer: operatorAuthorizer },
  configureDataPlane: () => ({
    authenticate: queryAuthenticator,
    resolveTenant,
    executeSemanticPlan,
    executeCompiledSql,
    runtimeArgument: ({ input, principal, tenant }) => ({ input, principal, tenant }),
  }),
});

await service.start();
const queryHandler = createDeploymentDataPlaneNodeHandler(
  service.host.dataPlane({ project: 'analytics', environment: 'production' }),
);
```

Cloud and other distributed systems can use the same host, supervisor, and HTTP
adapter interfaces while supplying provider-owned persistence, runtime, SQL,
authentication, tenant, routing, and observability implementations. The
filesystem assembly is a reference single-host composition, not a distributed
control plane.

The package is ESM-only and requires Node.js 20 or newer.
