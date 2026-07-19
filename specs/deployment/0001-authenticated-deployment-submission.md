# Deployment transport 0001: Authenticated deployment submission

- Status: Proposed
- Version: deployment submission 1

## Summary

This specification defines the authenticated transport that submits one RFC 0008 release
and the exact files of its referenced RFC 0007 bundle to a receiving service.
It is an acceptance boundary only: a successful submission does not activate,
execute, promote, or otherwise mutate the release lifecycle.

## Request

The client sends an HTTPS `POST` to a configured submission endpoint. Redirects
are rejected so credentials cannot be forwarded to an endpoint that was not
explicitly configured. The request uses these headers:

- `Authorization: Bearer <token>`;
- `Idempotency-Key: <release identity>`;
- `X-HypeQuery-Release-Identity: <release identity>`;
- `X-HypeQuery-Bundle-Identity: <bundle identity>`;
- `Content-Type: multipart/form-data; boundary=<boundary>`;
- an exact `Content-Length`.

Header identities are routing and early-rejection hints, not trusted evidence.
The receiving service derives both identities again from the uploaded content.

The multipart body contains these parts in order:

1. `release`, filename `release.json`, `application/json`: the canonical RFC
   0008 bytes;
2. `bundle`, filename `bundle.json`, `application/json`, with
   `X-HypeQuery-Bundle-Path: bundle.json`: the canonical RFC 0007 manifest plus
   one trailing newline;
3. one repeated `bundle` part for the deployment file and then each artifact in
   manifest order. Each has `application/json` or `application/octet-stream`
   content type and an `X-HypeQuery-Bundle-Path` matching its manifest path.

The multipart boundary is transport framing and is not identity-significant.
The client streams deployment and runtime files from no-follow file handles,
enforces each manifest byte length while streaming, and recomputes each SHA-256
before completing the request. If local bytes changed after bundle verification,
the request is aborted.

## Acceptance

Before accepting a request, the receiving service MUST:

1. authenticate the caller and authorize the release target project and
   environment;
2. enforce request, part-count, path, and byte limits before buffering data;
3. parse and validate the release and bundle manifest with their versioned
   validators;
4. reconstruct only the declared closed bundle and perform complete RFC 0007
   verification without following symbolic links or trusting part filenames;
5. require the recomputed bundle identity to equal the release
   `bundleIdentity` and both identity headers;
6. use the recomputed release identity as the idempotency key.

The bearer token, header identities, multipart filenames, client-provided
content types, and an existing idempotency record do not replace authorization
or content verification.

## Success response

The response is a closed JSON object:

```json
{
  "kind": "hypequery-deployment-submission",
  "version": 1,
  "status": "accepted",
  "releaseIdentity": "<64 lowercase hexadecimal characters>",
  "bundleIdentity": "<64 lowercase hexadecimal characters>"
}
```

`status` is `accepted` for a newly persisted submission or `already-exists`
for an authorized idempotent replay of the same release. Returned identities
MUST match the request after server-side recomputation. Unknown response fields,
invalid UTF-8 or JSON, responses larger than 64 KiB, and identity mismatches fail
closed on the client.

A newly persisted submission returns HTTP `202`. An authorized, fully verified
idempotent replay returns HTTP `200`. Neither response activates or executes the
release.

## Reference receiver

`@hypequery/deployment` provides the framework-neutral TypeScript reference
receiver. Its request adapter accepts a header record and streaming byte body;
its response adapter returns an HTTP status, headers, and bounded JSON body.
Authentication, target authorization, and atomic persistence are deliberately
pluggable provider responsibilities.

The reference receiver authenticates before consuming body bytes, authorizes
after validating the canonical release, streams only manifest-declared bundle
paths into a unique temporary directory, then invokes the same complete bundle
filesystem verifier used by the CLI. The persistence callback must copy every
required byte before it resolves because the temporary directory is removed on
both success and failure.

## Rejection and client errors

Non-success HTTP statuses reject the submission. A service may return a bounded
JSON error object with string `code` and `message` fields for diagnostics; HTTP
status remains authoritative. The CLI exposes these stable local error classes:

- `HQ_UPLOAD_CONFIGURATION`;
- `HQ_UPLOAD_IDENTITY_MISMATCH`;
- `HQ_UPLOAD_BUNDLE_CHANGED`;
- `HQ_UPLOAD_NETWORK`;
- `HQ_UPLOAD_REJECTED`;
- `HQ_UPLOAD_INVALID_RESPONSE`.

Automatic retries are not required. Callers may retry an unchanged release
because its release identity is a deterministic idempotency key.
