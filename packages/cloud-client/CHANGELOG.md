# @hypequery/cloud-client

## 0.2.0

### Minor Changes

- 8c1a8a8: Regenerated from Cloud's latest `operations-v1.json`: 92 operations, adding `organization.update` (`PATCH /org`, with `ORGANIZATION_SLUG_TAKEN`), members (`changeRole`, `remove`), customer access (signing keys, customer app listing), `logs.get`, `drafts.evidence` and `drafts.replay` (a `POST`), `managementTokens.list` and `.revoke`, and `feedback.create`, with their error codes. Some of these operations are still in review in Cloud and may change before they ship there. Path parameters of `.` or `..` are refused before sending, since URL parsing would resolve them to another route.

  The client no longer follows redirects (`redirect: 'error'`), so the bearer token goes only to the configured URL; a redirect is reported as `UNEXPECTED_RESPONSE`.

- 5fa3d76: Refresh the operations spec from hypequery Cloud: 92 operations, up from 78.

  - New methods: `signingKeys.list`, `signingKeys.create` and `signingKeys.revoke` (the managed keys `mintAgentToken` signs with), `logs.get` (one request by its request id), `feedback.create`, `managementTokens.list` and `managementTokens.revoke`, `members.changeRole` and `members.remove`, `organization.update`, `customerApp.get` and `customerApp.set`, and `drafts.evidence` and `drafts.replay`.
  - New error codes: `SIGNING_KEY_NOT_FOUND`, `SIGNING_KEY_LIMIT`, `REQUEST_NOT_FOUND`, `MANAGEMENT_TOKEN_NOT_FOUND`, `ORGANIZATION_SLUG_TAKEN` and `RATE_LIMITED`.
  - `PROJECT_HAS_SEVERAL_TARGETS` is no longer a `CloudErrorCode`: Cloud addresses each project by itself, so no operation returns it.
  - `projects.create` and `projects.rename` need the `project:create` capability (was `environment:create`). `customerAccess.prove`, `members.invite` and `members.cancelInvitation` are now available to the Claude connector, so a connector or token can send and cancel invitations. `members.invite` and `members.cancelInvitation` no longer list `SESSION_REQUIRED`.

  No existing operation's input or output changed.

## 0.1.0

### Minor Changes

- 53d5934: New package: a typed client for hypequery Cloud's `/v1` operations, generated from Cloud's `operations-v1.json`. One method per operation with typed input and output, `confirm: true` required on destructive operations, bearer-token auth, and `CloudApiError` carrying Cloud's error envelope (code, hint, retryable, correctable, requestId, issues).
