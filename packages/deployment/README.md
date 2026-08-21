# @hypequery/deployment

Provider-neutral building blocks for receiving, verifying, activating, and hosting Hypequery deployment bundles.

This package is for Cloud providers and self-hosted control planes. Application teams normally use `hypequery deploy` through `@hypequery/cli` instead.

## What it protects

Every deployment is treated as immutable content. Before storage or execution, the package verifies:

- the target-bound release envelope;
- the closed bundle manifest;
- declared paths and byte limits;
- every file hash and artifact reference;
- deployment, bundle, and release identities;
- activation revision consistency.

Symbolic links, undeclared files, path traversal, missing content, and identity mismatches fail closed.

## Provider building blocks

- streaming authenticated intake;
- provider-owned authentication, authorization, and storage interfaces;
- a durable reference filesystem store;
- compare-and-swap activation and rollback;
- Node and Fetch control-plane adapters;
- immutable runtime materialization;
- readiness-gated runtime supervision;
- named-query data-plane execution;
- a reference single-host composition.

## Minimal intake

```ts
import { createDeploymentIntake } from '@hypequery/deployment';

const intake = createDeploymentIntake({
  authenticator: {
    authenticate: ({ token }) => authenticateToken(token),
  },
  authorizer: {
    authorize: ({ principal, target }) =>
      canDeploy(principal, target),
  },
  store: {
    accept: (submission) => persistVerifiedSubmission(submission),
  },
});
```

Authentication happens before upload bytes are consumed. The store receives a fully verified temporary bundle and must persist required bytes before returning.

## Single-host reference

```ts
import { createFileSystemDeploymentHost } from '@hypequery/deployment';

const service = createFileSystemDeploymentHost({
  directory: '/var/lib/hypequery/deployments',
  targets: [{ project: 'analytics', environment: 'production' }],
  intake: {
    authenticator: deploymentAuthenticator,
    authorizer: deploymentAuthorizer,
  },
  controlPlane: {
    authenticator: operatorAuthenticator,
    authorizer: operatorAuthorizer,
  },
  configureDataPlane,
});

await service.start();
```

Distributed providers can keep the same interfaces while replacing persistence, runtime isolation, secret resolution, routing, and observability.

## Trust boundary

The reference Node worker manages lifecycle and immutable generations for trusted deployment code; it is not a hostile-code sandbox. The filesystem store assumes its configured directory is controlled by the operator.

## Specifications

- [Deployment transport](../../specs/deployment/README.md)
- [Security protocol](../../specs/security-protocol/README.md)

Requires Node.js 20 or newer and ESM.

## License

Apache-2.0.
