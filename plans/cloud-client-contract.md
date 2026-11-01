# Cloud client contract: typed React and tenant review without hand-written config

Date: 2026-10-30
Status: K-12 in progress, K-13 and K-14 Todo
Cloud tracker: rows K-12 to K-14 and W-01 to W-09 in hypequery-cloud
`plans/chat-redesign.md`. Plan: hypequery-cloud `plans/connect-tenant-scoped.md`.
Linear: HQ-167.

## Problem

A React app using a Cloud-published dataset has to:

- hand-write each dataset's method and path in `createAnalyticsHooks({ config })`;
- import an API type from an `analytics/api.ts` that Cloud projects don't have.

Only Python can produce the client contract that `hypequery generate:client`
turns into `ClientApi` and `clientManifest`, and Cloud serves none.

## K-12: `buildClientContract` (this PR)

`buildClientContract(deployment, options)` in `@hypequery/datasets` builds a
signed `ProtocolClientContract` from a `ProtocolDeploymentContract`. Cloud
holds that contract for chat-authored and code-deployed projects alike, so one
builder serves both.

### Field mapping

The mapping follows Python's builder (`python/.../datasets/client_contract/`):

| Client field | Rule |
| --- | --- |
| Endpoints | One per dataset with an `endpoint` policy. Relationship targets aren't advertised. |
| `path` | `mountPath + (paths[name] ?? endpoint.path)`. |
| Dimensions | `nullable: 'unknown'`. `wireType` is `number-or-string` for numbers. `groupable` and `orderable` come from `groupable`. |
| Measures | `{ wireType: 'string', nullable: true }`. `having` is false only for `min`/`max`/`argMin`/`argMax` over a non-number dimension. A measure whose fixed filters cross a relationship is dropped. |
| Filters | From the contract's filters. The tenant column is never a request filter. Operators are narrowed by type (boolean: equality, membership and null checks; number: no `like`), sorted and de-duplicated. |
| `time` | The portable grains (deployment contract 2 carries day and longer), `defaultTimezone` from the profile, `timezone: true`. |
| `defaultMeasures` | The advertised base (non-derived) measures. |
| `limits` | The profile narrowed by the dataset's `limits` and the endpoint's `maxLimit`. |
| `annotations` | Dataset description, plus field labels and descriptions with whitespace folded. |
| Hashes | `prepareProtocolClientContract`, the same code `generate:client` verifies with. |

### Differences from Python, deliberately

- **Relationship fields aren't exported yet.** This matches Python's default
  (`related=()`). Exporting them needs the relationship-measure rules ported
  and Cloud to confirm it serves them.
- **No metric endpoints.** Deployment contract 2 has no metrics.
- **`defaultMeasures` follows the contract's measure order,** not authoring
  order. That is stable for a given contract, which is what the hash pins.

### Not in this PR

- A cross-language fixture under `specs/security-protocol/fixtures/client-contract-v1/`.
  Python builds from `Dataset` objects, not deployment contracts, so there is
  no second implementation to hold to it yet. Unit tests pin the behaviour.

## K-13: `generate:client --cloud`

This lands after Cloud serves the contract (W-04).

- `hypequery generate:client --cloud` reads the target and credential from
  `hypequery login` and fetches `/v1/deployments/targets/{p}/{e}/client-contract`
  through `liveUrl(..., 'client-contract')`.
- It writes the same file as today, plus `export const clientBaseUrl`.
- `--check` works with `--cloud` for CI, and `deploy --client <path>`
  regenerates after a publish.
- React gains a `ClientSchemaChangedError` for `409 CLIENT_SCHEMA_CHANGED`.
- Docs: `website-next/docs/react/cloud.mdx`.

## K-14: tenant review on deploy

- `hypequery deploy` warns about datasets with tenant-candidate columns (the
  `generate:datasets` heuristic) and no `tenantKey`.
- The `cloud.ts` scaffold says what empty roles and scopes mean.
