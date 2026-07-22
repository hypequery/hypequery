---
'@hypequery/serve': minor
---

Harden request-ID handling: authoritative id is now server-generated (R0-04).

The `x-request-id` on responses and in logs is always a server-generated authoritative
identifier and is never derived from client input. A caller-supplied `x-request-id` or
`x-trace-id` is validated (control characters rejected, bounded to 200 UTF-8 bytes) and
surfaced only as a separate, non-authoritative `x-correlation-id` response header. This
closes a path where a client could inject control characters into logs/headers or spoof
cross-request correlation via the authoritative id.

Additive and non-breaking to the API surface: `x-request-id` is still present on every
response; only its value changes from an echoed client header to a trusted server id, with
the validated client value preserved under `x-correlation-id`.
