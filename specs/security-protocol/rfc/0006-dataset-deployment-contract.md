# RFC 0006: Deployment contract

- Status: Proposed
- Version: deployment contract 2

## Summary

A deployment contract is the validated, deterministic description of datasets
that managed execution can serve. It carries dataset definitions, base and
derived measures, relationships, and endpoint policy. Named queries, standalone
metrics, runtime artifacts, executable callbacks, credentials, and connection
configuration are outside this contract.

The sole supported envelope is a closed object with
`kind: "hypequery-deployment"`, `version: 2`, and a `datasets` array.
`queries`, `artifacts`, and dataset `metrics` are invalid even when empty.
Unknown fields fail validation.

## Datasets

Each dataset declares a unique logical name, physical source, tenant policy,
dimensions, measures, filters, and relationships. Optional fields include a
time field, defaults, freshness, limits, endpoint policy, description, owner,
and semantic metadata. Dimensions may name a physical column or carry a
bounded trusted SQL expression. Relationships must name a dataset in the same
contract; `belongsTo` and `hasOne` are queryable, while `hasMany` remains
metadata only.

A base measure declares its aggregation, input field, fixed filters, and
applicable aggregation options. A derived measure lives in the same `measures`
array with `kind: "derived"`. Its `uses` entries map distinct aliases to base
measures in that dataset, and its formula references exactly those aliases.
Derived measures cannot depend on another derived measure. Validation retains
the authored order of measures and aliases so rehydration produces the same
query plan.

Dataset defaults must refer to groupable dimensions; a default time grain
requires a time field. If an endpoint is present, its required tenant policy
must agree with the dataset tenant policy. Endpoint access can be public or
authenticated with declared roles and scopes. Tenant extraction and
authentication implementations remain runtime concerns.

## Metadata and limits

Datasets, dimensions, measures, and filters may carry bounded examples,
synonyms, format, unit, currency, timezone, and sensitivity metadata.
Sensitivity describes data; it does not enforce authorization.

The reference limits are 100 datasets; 1,000 items per dataset collection;
100 examples, synonyms, or default dimensions; 4,096 UTF-8 bytes per text
field; 1,024 bytes for physical source names; and 2,048 bytes for endpoint
paths. Consumers may tighten but not raise these validation limits.

## Canonical bytes and identity

Validate the complete envelope before encoding. Its canonical bytes are the
UTF-8 encoding of its RFC 8785 JSON serialization. The deployment identity is
lowercase hexadecimal SHA-256 of the UTF-8 domain prefix
`hypequery:deployment:v2\0` followed by the canonical bytes. `\0` is one
zero byte. The newline in a presentation JSON file is not hashed.

Validation rejects custom prototypes, accessors, symbols, hidden properties,
cycles, sparse arrays, and extra array properties. It returns a detached,
deeply immutable snapshot. Failures use the `HQ_DEPLOYMENT_*` codes defined
by the protocol package.
