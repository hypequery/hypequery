# Semantic invocation v1 fixtures

These fixtures exercise RFC 0014 semantic invocation records: the dataset/metric invocation request, the successful result, and the closed failure record.

- `success.json` contains accepted language-neutral records, each tagged with the `record` it validates against.
- `rejections.json` pins generated invalid inputs and stable error codes.

Coverage includes closed fields, versions, the normalized single identifier location, activation-revision format, budget floors and ceilings, an empty budget, row and column limits, non-finite and non-scalar cells, a `rowCount` that disagrees with `data`, failure categories, provider-shaped failure codes, control characters, and unsafe accessors.

Every record carries a `record` discriminator (`invocation`, `result`, or `failure`) so one family covers all three without three near-identical fixture sets.
