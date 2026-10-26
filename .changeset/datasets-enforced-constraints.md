---
'@hypequery/datasets': minor
---

Add enforced constraints to `createDatasetClient`: `context.runtime.constraints` takes RFC 0019 comparisons (a declared filter or a one-hop `relationship.field`) resolved from trusted context. They are ANDed onto every read of the dataset's source, in every query shape: aggregate, derived, `having`, window, shift, metrics, derived metrics and relationship joins. A constraint the dataset can't enforce refuses the call without describing the constraint. Constraints share the dataset's `maxFilters` ceiling with the caller (at most 32 per call), enter the result-cache key, and are refused on the deprecated semantic-backend path rather than dropped. The runtime tenant and constraints are now applied at a single source-scoping step (RFC 0020). Queries without constraints generate identical SQL and keep their cache keys.
