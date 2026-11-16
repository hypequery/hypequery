---
'@hypequery/cloud-client': minor
---

Refresh the operations spec from hypequery Cloud: 92 operations, up from 78.

- New methods: `signingKeys.list`, `signingKeys.create` and `signingKeys.revoke` (the managed keys `mintAgentToken` signs with), `logs.get` (one request by its request id), `feedback.create`, `managementTokens.list` and `managementTokens.revoke`, `members.changeRole` and `members.remove`, `organization.update`, `customerApp.get` and `customerApp.set`, and `drafts.evidence` and `drafts.replay`.
- New error codes: `SIGNING_KEY_NOT_FOUND`, `SIGNING_KEY_LIMIT`, `REQUEST_NOT_FOUND`, `MANAGEMENT_TOKEN_NOT_FOUND`, `ORGANIZATION_SLUG_TAKEN` and `RATE_LIMITED`.
- `PROJECT_HAS_SEVERAL_TARGETS` is no longer a `CloudErrorCode`: Cloud addresses each project by itself, so no operation returns it.
- `projects.create` and `projects.rename` need the `project:create` capability (was `environment:create`). `customerAccess.prove` and `members.cancelInvitation` are now available to the Claude connector.

No existing operation's input or output changed.
