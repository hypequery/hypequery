---
"@hypequery/datasets": minor
---

Add `queryableDatasets` to `buildCanonicalSemanticQuerySchemas` options: the
datasets that may be named as a direct query target, defaulting to all of them.

A dataset left out still contributes its metrics and can still be joined to; it
is only withheld from the `query_dataset` schema. That split exists because a
deployment contract authorizes a dataset and each of its metrics through
separate endpoint policies, so a caller can be entitled to a metric on a dataset
it may not query directly. Compiling one schema for both cases would either
advertise a target the caller cannot use or hide a metric it can.
