# RFC 0030: Deployment-target capability advertisement and version selection

- Status: Proposed
- Version: none (one optional member in the live deployment state response;
  no artifact changes)
- Amends: RFC 0014 (invocation version selection), RFC 0015 (versioning and
  selection)

## Summary

RFC 0015's lowest-version rule picks a deployment contract version from the
deployment's content alone. Nothing checks that version against what the
deployment target will accept. The only claim about that is static: the
`cloudDeploymentVersion` and per-feature `cloud` flags in
`packages/datasets/src/execution-capabilities.json`, which nothing reads at
deploy time. Core 0.34 began publishing a dataset's `timeKeys` as contract 3
while hypequery Cloud stored contract 2 only, so upgraded CLIs had their
deploys refused after the bundle was built and uploaded. The matrix said Cloud
executes contract 3.

The same gap exists on the query side. Which semantic invocation version an
operation needs is decided by a private function, so a caller has to copy it
or hard-code a version. Cloud hard-coded invocation 1 and expression
extension 1.

This RFC makes the target the authority:

1. A deployment target **advertises** the versions it accepts in its live
   state response.
2. The CLI **checks** the version it produced against that advertisement
   before upload, and fails naming the features that forced the version. It
   never lowers the version.
3. Query features are gated by **semantic invocation version only**. The
   contract version does not gate them.
4. The static matrix stops making claims about Cloud.
5. A compatibility policy says how contract and query versions may change from
   now on, so that a consumer can follow every change through version-neutral
   readers.

## 1. Target advertisement

### Where

hypequery Cloud serves the live state of a deployment target at
`GET /v1/deployments/targets/{project}/{environment}/state`, beside the
submissions endpoint. `hypequery deploy` already reads it before upload to
detect a restored or Cloud-authored live release. The response is
`kind: "hypequery-live-deployment"`, `version: 1`.

This RFC adds one optional member to that response, `accepts`:

```json
{
  "kind": "hypequery-live-deployment",
  "version": 1,
  "target": { "project": "acme", "environment": "production" },
  "active": null,
  "accepts": {
    "deploymentContract": [2, 3],
    "semanticInvocation": [1, 2],
    "bundle": [1, 2]
  }
}
```

`accepts` describes the target, not the active release. It is present whether
or not a release is active, so a first deploy to a new environment sees it.
Cloud SHOULD answer `state` for every target the credential may deploy to,
including one with no activation (`active: null`), rather than `404`.

### Members

| Member | Meaning | Default when absent |
| --- | --- | --- |
| `deploymentContract` | Deployment contract versions (RFC 0006, RFC 0015) the target stores, activates and serves | `[2]` |
| `semanticInvocation` | Semantic invocation versions (RFC 0014, RFC 0015) its data plane executes, against every contract version it accepts | `[1]` |
| `bundle` | Deployment bundle manifest versions (RFC 0007) its intake accepts | `[1, 2]` |

Each member is a non-empty array of distinct positive safe integers in
ascending order. An unsorted, repeated, empty or non-integer list makes the
response invalid. The consumer fails closed (`Cloud returned an invalid live
deployment response.`) rather than guessing what the target meant.

A missing `accepts`, or a missing member, takes the default above. The
contract and invocation defaults are the versions every hypequery Cloud
release has served. The bundle default is wider because Cloud's intake is
Core's, and Core has accepted bundle version 2 since business context
shipped. A target that accepts less than a default MUST advertise the member.

Unknown members of `accepts` are ignored, so a later RFC can add one, such as
a per-family feature list, without breaking older CLIs. A version a consumer
doesn't know, such as contract 4 in an advertisement read by a CLI that
produces at most 3, is not an error. The consumer never produces it.

`accepts` is a statement about what the target will do, not a negotiation.
The target's intake and data plane still validate every artifact and refuse
what they cannot run, as RFC 0015 and decision 0001 require.

### Targets without a state resource

The CLI derives the state URL from a Cloud submissions endpoint
(`…/v1/deployments/submissions`). A control plane assembled from
`@hypequery/deployment` at another URL has no state resource, so it gets no
pre-upload check, and its intake refusal is the only signal. A Cloud state
response of `404` means the target is unknown to the credential. The CLI then
applies the defaults, because it cannot tell an unknown target from a Cloud
release that predates `accepts`.

### What Cloud returns today

The advertisement must describe what Cloud actually runs. While Cloud stores
and serves contract 2 only, it returns `"deploymentContract": [2]`. When it
stores contract 3, it adds 3. `semanticInvocation` lists the invocation
versions its executor validates and runs, which today is whatever its Core
`@hypequery/deployment` version accepts, and `bundle` lists the manifest
versions its intake keeps.

## 2. Producer check before upload

Version **selection** is unchanged. RFC 0015's lowest-version rule picks the
contract version from content, and RFC 0007 picks the bundle version from
content (version 2 exactly when the bundle carries business context). Identity
stays a function of content.

After building the bundle and reading the target's state, and before
uploading anything, the CLI checks:

- that the bundle's contract version is in `accepts.deploymentContract`, and
- that the bundle manifest version is in `accepts.bundle`.

On a mismatch, `hypequery deploy` and `hypequery deployment:submit` fail with
`DEPLOYMENT_VERSION_UNSUPPORTED` (category `correctable_input`, exit code
`1`). The message names:

- the target and the versions it accepts;
- the version the deployment needs; and
- for a contract, each dataset and the contract 3 features it uses, in
  [registry](#contract-3-feature-registry) order; for a bundle, the business
  context that made it version 2.

For example:

```text
acme/production accepts deployment contract 2, but this deployment is contract 3.
  orders uses segments, alternate time keys
  events uses window measures
Remove these features, or deploy to a target that accepts contract 3.
```

The CLI MUST NOT lower the version. Rewriting a contract 3 deployment as
contract 2 would drop segments, windows, shifts or time axes, and a deploy that
silently loses part of the model is worse than one that is refused. The only
remedies are to remove the features or to deploy to a target that accepts the
version.

A draft upload (`--draft`) doesn't read the live state, so it isn't
pre-checked. Cloud's intake refusal then applies, and it SHOULD name the
version and the forcing features the same way. Cloud can call the same
reference function.

### Contract 3 feature registry

A dataset forces contract 3 exactly when it uses one of these. The list is
derived from the contract, not from authoring source, so any implementation
that holds a contract computes the same answer:

| Feature | Contract evidence | Message wording |
| --- | --- | --- |
| `segments` | non-empty `segments` | segments |
| `windowMeasures` | a measure with `kind: "window"` | window measures |
| `shiftMeasures` | a measure with `kind: "shift"` | shift measures |
| `approxCountDistinct` | a base measure with aggregation `approxCountDistinct` | approxCountDistinct |
| `subDayDefaultGrain` | `defaults.timeGrain` of `minute` or `hour` | a sub-day default grain |
| `alternateTimeFields` | non-empty `alternateTimeFields` (RFC 0029) | alternate time keys |

The `allowedFilters` rename never forces contract 3 (RFC 0015). A later
contract version extends this registry in the RFC that defines it, and the
reference implementations and shared fixtures change in the same release.

## 3. Query features are gated by invocation version

RFC 0015 says a query selects window and shift measures by simple name, so
they need no new invocation. This RFC states the general rule: **a query
feature is gated by semantic invocation version (and the expression extension
it selects) only. The deployment contract version never gates a query
feature.** A contract version limits what a dataset can *declare*, not what a
query may *ask*. Under the lowest-version rule, for example, a contract 2
dataset cannot carry a sub-day `defaults.timeGrain`, but a query may still
bucket it `by: "hour"`.

A caller picks the invocation version from the operation with the
lowest-version rule. If the target doesn't accept that version, the caller
refuses the call locally and names the features, just as the deploy check
does. It MUST NOT drop the features to fit a lower version.

### Query features by version

As implemented in Core 0.34:

| Query feature | Since | Lowest invocation |
| --- | --- | --- |
| `dimensions` (including one-hop qualified), simple `measures`, `orderBy`, `limit`, `offset`, `includeMeta` | RFC 0003 | 1 |
| `by` with `day`, `week`, `month`, `quarter`, `year` | RFC 0003 | 1 |
| `logical` `and`/`or`/`not` filter groups | RFC 0003, run since RFC 0029 | 1 |
| `isNull`/`isNotNull` comparisons | RFC 0023 | 1 |
| `having`, `timezone` | RFC 0025 | 1 |
| `inDateRange`, `fill`, `timeKey` | RFC 0029 | 1 |
| Funnel and retention operations | RFC 0027 | 1 only |
| `segments` | RFC 0015 | 2 |
| `by` with `minute` or `hour` | RFC 0015 | 2 |
| Qualified relationship `measures` (`customer.customerCount`) | RFC 0015 | 2 |
| `calculations`, `limitBy`, `other` | RFC 0026 | 2 |

Invocation 2 differs from invocation 1 only in validating `operation` under
expression extension 2. An operation that uses no extension 2 feature is
invocation 1, and invocation 2 rejects it (RFC 0015). Funnel and retention
operations use no extension 2 feature, so they are invocation 1 only.

### Current behaviour: invocation 2 on a contract 2 release

Core's data plane (`createDeploymentSemanticDataPlane`) validates the
invocation envelope independently of the release's contract version. It then
checks the operation against the contract
(`semantic-operation-validation.ts`, `semantic-calculation-validation.ts`),
and neither check reads the contract version. A contract 2 release therefore
accepts invocation 2, and with the portable executor:

- `by: "minute"` or `"hour"` runs, on any dataset with a `timeField`;
- `calculations` (for example `share`), `limitBy` and `other` run;
- `segments` is refused as `input-invalid`, `HQ_SEMANTIC_INPUT_INVALID`,
  `Unknown segment "<name>".`, because a contract 2 dataset cannot declare one;
- a qualified relationship measure is refused as `Unknown measure` under
  **every** contract version. The data plane resolves only a dataset's own
  measures. This is an execution gap, not a contract 2 limit.

`packages/deployment/src/semantic-invocation-2-contract-2.test.ts` pins this
behaviour. A target that advertises `semanticInvocation: [1, 2]` and
`deploymentContract: [2]` is consistent.

### Rule for future query fields

Every query field, operator, grain, enum value or operation kind added after
this RFC goes in a **new expression extension and semantic invocation
version**, and the lowest-version rule selects it. Expression extensions 1 and
2, and invocations 1 and 2, are frozen at the table above.

Envelopes are closed, so a peer that predates a field refuses it, and the
caller cannot tell beforehand whether a target will. RFC 0025 and RFC 0029
added fields to extensions 1 and 2 in place, which a target that advertises
invocation 1 may or may not run. A new version number is what lets
`accepts.semanticInvocation` answer the question. Several features that ship
together share one version. A target advertises a version only if it accepts
everything in it.

A per-feature capability list was considered and rejected. A single version
number is deterministic from content, fixture-testable, and comparable with
one membership test. A feature list would have to be negotiated per call, and
it invites partial support of a version.

## 4. The static matrix

`DATASET_EXECUTION_CAPABILITIES` (`execution-capabilities.json`) describes
Core: TypeScript and Python authoring and publishing, the protocol versions
that can represent each feature, and Core's portable runtime. It makes no
claim about any hosted service.

- `cloudDeploymentVersion` is removed from the matrix. What a target accepts
  is read from its advertisement.
- Each feature's `cloud` flag, which already meant the repository's portable
  runtime rather than a qualification of a hosted service, is renamed
  `portable`.

The TypeScript export keeps both old fields as deprecated aliases until a
planned major, because Core never deletes a shipped export. Tests and docs stop
asserting Cloud acceptance from the matrix.

This amends RFC 0015's [versioning and
selection](./0015-dataset-vocabulary-extension-2.md#versioning-and-selection).
The lowest-version rule still selects the version, and the target's
advertisement now decides whether the version may be sent.

## 5. Compatibility policy

These rules apply to every deployment contract, expression extension and
semantic invocation version from this RFC on.

1. **Additive only within a contract family.** A contract version may gain
   optional fields. Absence keeps the old meaning, and an older consumer
   refuses the field through the closed envelope rather than ignoring it. A
   contract version never renames, removes, retypes or reinterprets a field.
   That needs a new contract version, as `filters` → `allowedFilters` needed
   contract 3.
2. **A new contract version ships with version-neutral readers.**
   `@hypequery/protocol` (and Python `hypequery.protocol`) export accessors
   that take any accepted version for every field the new version renames,
   moves or adds. They ship in the same release as the version. Consumers read
   through them rather than branching on `version` or probing for a field
   name.
3. **Readers support every version ever accepted.** A release of an old
   version can stay live, or be restored, indefinitely. A reader's support for
   a version is removed only in a planned major, and only after no target
   advertises that version.
4. **Consumer-breaking changes are labelled.** A changeset that widens a
   public type (a return type becoming a union of versions, a union gaining a
   member), renames a public field or type, or makes content that used to
   produce one version produce a higher one (a new forcing feature), carries a
   line beginning `Consumer-breaking:`. The line names what downstream code
   or targets must change. Core 0.34's time-keys change would have carried
   one: "`timeKeys` now publish as contract 3. Targets that accept only
   contract 2 refuse such deployments."

## Reference implementation

`@hypequery/protocol` exports:

- **Readers**, taking a contract 2 or contract 3 dataset:
  - `datasetAllowedFilters(dataset)`, which returns `filters` or
    `allowedFilters`;
  - `datasetSegments(dataset)`, which returns `[]` on contract 2;
  - `datasetTimeAxes(dataset)`, which returns `timeField` followed by any
    `alternateTimeFields`, or `[]` without a time field;
  - `datasetGrains(dataset)`, the grains a query may bucket by;
  - `withDatasetAllowedFilters(dataset, filters)`, which writes the allow-list
    under the dataset's own version's name.
- **Selection:** `semanticInvocationVersion(operation)` and
  `toSemanticInvocation(operation, envelope)`.
- **Acceptance:** `datasetContract3Features(dataset)`,
  `DEFAULT_PROTOCOL_DEPLOYMENT_TARGET_ACCEPTS`,
  `validateProtocolDeploymentTargetAccepts(input)` and
  `checkProtocolDeploymentTargetAcceptance(…)`.

Python's `hypequery.protocol` mirrors the feature registry and the
advertisement validation.

## Conformance

Draft fixtures under `specs/security-protocol/drafts/target-acceptance-v1/`:

- `accepts.json`: advertisements and the value each parses to, including
  every default, and advertisements that are invalid;
- `contract-3-features.json`: contract datasets and the exact feature list each
  forces, one case per registry entry, combinations in registry order, and
  contract 2 datasets with none.

The TypeScript and Python test suites must both pass them. They aren't
registered in the conformance manifest until this RFC is accepted.

## Open questions

1. Should `accepts` move to a target-independent discovery resource, such as
   `GET /v1/deployments/capabilities`, so that a credential that can't read
   any target state still learns what Cloud accepts? This RFC keeps it on the
   state response that `deploy` already reads.
2. Should the CLI also pre-check draft uploads by reading state? A draft goes
   to the same target, but today's draft flow deliberately skips Production
   preflight.
