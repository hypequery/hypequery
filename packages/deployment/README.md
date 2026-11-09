# @hypequery/deployment

Provider-neutral building blocks for receiving, verifying, activating, and invoking Hypequery deployment bundles.

This package is for deployment providers and self-hosted control planes.

```bash
npm install @hypequery/deployment
```

## What it protects

Every deployment is treated as immutable content. Before storage or execution, the package verifies:

- the target-bound release envelope;
- the closed bundle manifest;
- declared paths and byte limits;
- every declared file hash and the canonical deployment JSON;
- deployment, bundle, and release identities;
- activation revision consistency.

Symbolic links, undeclared files, path traversal, missing content, and identity mismatches fail closed.

## Provider building blocks

- streaming authenticated intake;
- provider-owned authentication, authorization, and storage interfaces;
- a durable reference filesystem store;
- compare-and-swap activation (rollback is activating an earlier accepted release);
- Node and Fetch control-plane adapters;
- contract-driven semantic invocation with an injected dataset executor, provider-resolved tenants, field visibility, and enforced constraints (RFC 0019);
- authorization- and visibility-aware contract projection for discovery (`projectAuthorizedDeploymentContract`).

## Minimal intake

```ts
import { createDeploymentIntake } from '@hypequery/deployment';

// authenticateToken, canDeploy and persistVerifiedSubmission are your own functions.
const intake = createDeploymentIntake({
  authenticator: {
    // Resolve the principal, or null to reject the upload.
    authenticate: async ({ token }) => authenticateToken(token),
  },
  authorizer: {
    authorize: async ({ principal, target }) => canDeploy(principal, target),
  },
  store: {
    // Persist the bytes, then resolve 'accepted' or 'already-exists'.
    accept: async (submission) => persistVerifiedSubmission(submission),
  },
});

const response = await intake.handle({ headers, body, signal });
```

Authentication happens before upload bytes are consumed. The store receives a fully verified temporary bundle and must persist required bytes before returning.

## Trust boundary

This package validates the deployment contract and gates semantic calls, but does not execute datasets or supervise application code. Providers supply the executor, credentials, tenant resolution, routing, and runtime isolation. The filesystem store assumes its configured directory is controlled by the operator.

## Specifications

- [Deployment transport](https://github.com/hypequery/hypequery/blob/main/specs/deployment/README.md)
- [Security protocol](https://github.com/hypequery/hypequery/blob/main/specs/security-protocol/README.md)

Requires Node.js 20 or newer and ESM.

## License

Apache-2.0.
