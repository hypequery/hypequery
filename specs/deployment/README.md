# Hypequery deployment transport

This directory defines authenticated transport and control-plane handoff
contracts that consume immutable artifacts from the security protocol.

Unlike `specs/security-protocol`, these specifications may describe HTTP,
authentication, authorization, idempotent persistence, and service responses.
They must not weaken or replace the validation, identity, or closed-content
requirements of the referenced immutable artifacts.

Current specifications:

- `0001-authenticated-deployment-submission.md` defines streaming authenticated
  release intake;
- `0002-target-activation.md` defines immutable target activation and
  compare-and-swap behavior;
- `0003-control-plane-http.md` binds submission and activation to provider-neutral
  HTTP routes and adapters.
- `0004-runtime-materialization.md` converts a confirmed current activation into
  an immutable, fully revalidated runtime snapshot.
- `0005-runtime-supervision.md` defines readiness-gated runtime startup, atomic
  generation switching, invocation, draining, and the reference Node worker.
- `0006-data-plane-execution.md` defines named-query route matching, policy,
  schema application, implementation dispatch, and output validation.
