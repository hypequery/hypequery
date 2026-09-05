# Deployment contract v1 fixtures

These fixtures exercise RFC 0006 deployment envelopes containing datasets, named queries, endpoint policy, and runtime artifact references.

- `success.json` contains accepted language-neutral deployments.
- `rejections.json` pins generated invalid inputs and stable error codes.
- `identity.json` pins canonical bytes and deployment identities.

Coverage includes closed fields, versions, identifiers, relationship queryability, missing runtime artifacts, ambiguous routes, collection limits, source limits, and unsafe accessors.

Semantic metadata (`examples`, `synonyms`, `format`, `unit`, `currency`, `timezone`, `sensitivity`) plus dataset `description`, `owner`, `freshness`, and `defaults` are covered by the `dataset-with-semantic-metadata` success case and by rejections for an unsupported sensitivity, a non-ISO currency, empty defaults, a default dimension that is not groupable, a default grain without a time field, and a synonym list above the 100-item semantic-metadata ceiling.
