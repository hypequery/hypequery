# Cloud and Python sequencing

**Status:** Accepted working plan
**Updated:** 2026-07-22

## Decision

Ship the first Cloud product before committing to a production Python SDK or
Python deployment runtime.

Before Cloud, Python work is limited to one time-boxed, experimental
cross-language conformance probe. Its purpose is to test that the protocol's
canonical rules are genuinely language-neutral, not to establish a supported
Python product surface.

This sequencing does not weaken the language-neutral protocol boundary. Cloud
continues to consume and revalidate public protocol artifacts, and the runtime
supervisor continues to allow future Python, process, container, or remote
provider factories. The first Cloud runtime may remain Node-only.

## Why

A production Python implementation would create a second permanent product
surface: validators and canonical codecs, query and semantic APIs, ClickHouse
execution, framework integration, documentation, packaging, compatibility,
release automation, and security maintenance. Building that surface before
Cloud demand is known would delay the product while increasing the cost of
every protocol change.

A small independent implementation is still valuable. It can expose hidden
JavaScript assumptions around numbers, Unicode, object ordering, canonical
JSON, limits, and failure classification before Cloud persists or accepts
these artifacts.

## Pre-Cloud Python probe

The probe is deliberately bounded:

- **Time box:** 3–5 engineering days. Stop and record blockers rather than
  broadening the scope.
- **Contracts:** RFC 0001 tagged values and RFC 0002 portable identifiers only.
- **Interface:** an NDJSON adapter compatible with
  `@hypequery/protocol-conformance`.
- **Acceptance:** all `tagged-values-v1` and `identifiers-v1` cases pass,
  including applicable fuzz seeds, with the same outputs and stable failure
  codes as the TypeScript reference implementation.
- **Dependencies:** prefer the Python standard library; add no runtime
  dependency without a demonstrated correctness requirement.
- **Lifecycle:** experimental and unpublished. CI may run the adapter as a
  language-neutrality canary, but it is not a supported SDK.

If the probe finds disagreement, fix the normative specification, fixtures, or
reference implementation. Do not introduce a Python-specific interpretation.

### Explicitly out of scope before Cloud

- publishing to PyPI or promising Python version support;
- a Python query builder, semantic layer, Serve equivalent, or framework SDK;
- ClickHouse transport or compiled-query execution;
- a Python deployment runtime factory or Python workload hosting;
- porting the remaining protocol families merely for completeness.

## Cloud sequence

1. Keep the existing protocol specifications, fixtures, and TypeScript
   reference implementation authoritative.
2. Run the bounded RFC 0001/0002 Python conformance probe.
3. Build and validate the Cloud MVP using the existing Node runtime and
   runtime-neutral deployment interfaces.
4. Reassess Python after real Cloud usage and workload demand are known.

CH-02 and RX work that changes existing execution semantics remains governed
by the separate major-release hold. This plan does not pull those changes
forward.

## Conditions for a production Python investment

Start a supported Python SDK or runtime only when all of the following are
true:

- users need Python authoring or Cloud-hosted Python workloads, rather than a
  hypothetical second-language option;
- the relevant protocol and artifact versions are stable enough to support
  independently;
- there is explicit ownership for Python testing, packaging, releases,
  compatibility, documentation, and security response;
- the first product slice and its compatibility boundary are separately
  defined and can ship without cloning the entire TypeScript stack.

Until those conditions hold, Python remains a conformance probe and future
provider boundary, not a precondition for Cloud.
