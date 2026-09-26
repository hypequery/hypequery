---
'@hypequery/datasets': minor
---

Relationship joins no longer fall back silently. A query builder without `leftAnyJoin` now rejects relationship-qualified queries with a clear error instead of downgrading to a fan-out `leftJoin`. The in-memory backend refuses duplicate to-one target keys and never matches `NULL` keys. The new `checkRelationships(dataset, { queryBuilder })` reports `belongsTo`/`hasOne` targets whose join key is not unique.
