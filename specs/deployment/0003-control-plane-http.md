# Deployment control plane 0003: HTTP transport

- Status: Proposed
- Version: deployment control-plane HTTP 1

## Summary

This specification exposes authenticated release submission and target
activation through a provider-neutral HTTP control plane. It binds the intake
contract from specification 0001 and the activation contract from specification
0002 to closed routes and JSON messages without defining runtime loading,
traffic switching, or provider credentials.

## Routes

The v1 routes are:

| Method | Path | Action |
| --- | --- | --- |
| `POST` | `/v1/deployments/submissions` | Submit one release and closed bundle using the multipart contract from specification 0001. |
| `PUT` | `/v1/deployments/targets/{project}/{environment}/activation` | Compare-and-swap the target's active release. |
| `GET` | `/v1/deployments/targets/{project}/{environment}/activation` | Read the current activation, or `null`. |
| `GET` | `/v1/deployments/targets/{project}/{environment}/activations` | Read bounded activation history. |

Project and environment path segments are percent-decoded exactly once and
then validated with the release-target v1 constraints. Unknown routes return
`404`; a known route with the wrong method returns `405` and an `Allow` header.

Submission requests are delegated unchanged to deployment intake. In
particular, the control plane MUST NOT buffer or pre-consume their multipart
body.

## Authentication and authorization

Every activation read or write requires one strict `Authorization: Bearer
<credential>` header. The provider authenticator maps the opaque credential to
a principal. The provider authorizer receives that principal, the validated
target, and one of these actions:

- `activate`;
- `read-current-activation`;
- `read-activation-history`.

Authentication and authorization MUST complete before an activation write body
is read. A missing or invalid credential returns `401`; a valid principal that
cannot perform the action returns `403`. Submission authentication and
authorization retain the ordering defined by specification 0001.

## Activation write

An activation write requires `application/json` and this exact object shape:

```json
{
  "kind": "hypequery-deployment-activation-request",
  "version": 1,
  "releaseIdentity": "<64 lowercase hexadecimal characters>",
  "expectedRevision": null
}
```

`expectedRevision` may instead be a 64-character activation revision. Unknown
properties, invalid UTF-8, duplicate query parameters, unsupported media types,
and bodies over the configured limit are rejected. A declared `Content-Length`
is checked against both the limit and the received byte count.

A committed transition returns `201` with status `activated`. An idempotent
request for the already-active release returns `200` with status
`already-active`. A failed compare-and-swap returns `409`, status `conflict`,
and the current activation without changing state.

## Activation reads

The current route accepts no query parameters or request body and returns the
validated target plus `activation`, which is an activation record or `null`.

The history route accepts only:

- `limit`: a canonical positive decimal integer no greater than the configured
  page-size limit;
- `before`: an activation revision previously returned as `nextBefore`.

History records are returned in chronological order. A page contains records
strictly before its `before` cursor. `nextBefore` is the cursor for the next
older page or `null` when no older record remains. Repeated parameters and
unknown cursors fail closed.

## Responses and errors

Control-plane JSON responses are UTF-8, use `Cache-Control: no-store`, and have
a trailing line feed. Errors have this bounded shape:

```json
{
  "error": {
    "code": "HQ_CONTROL_BAD_REQUEST",
    "message": "The activation request is invalid."
  }
}
```

Stable control-plane codes distinguish malformed requests, authentication,
authorization, missing routes, method mismatches, size limits, missing or
temporarily unavailable releases, and internal failures. Internal storage and
provider error details MUST NOT appear in a response.

## Transport adapters

The reference Fetch and Node adapters translate URL, method, headers, query,
abort state, and response metadata. Both expose request bodies as
`AsyncIterable<Uint8Array>` and MUST preserve streaming for multipart
submissions. Core limits remain authoritative; adapters do not introduce a
second buffering limit or parse payloads themselves.

## Out of scope

This version does not define credential issuance, CORS, service discovery,
runtime materialization, health checks, traffic routing, automatic rollback,
retention, or garbage collection.
