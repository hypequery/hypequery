---
"@hypequery/datasets": patch
---

Fix calendar shifts (`month`, `quarter`, `year`) on a partial `week` bucket.
When a query filter cut a week short, its lower bound was shifted on its own
while its upper bound stayed anchored to the shifted week. A week starting
mid-way could get an empty range and read `null` even when the prior period had
rows, and a week cut on both sides could count rows from days it never covered.
Both bounds are now placed inside the shifted week: a whole week still maps to
its start minus the interval plus seven days, and a partial week maps to the
matching slice. Shifted formulas (derived, windowed and cumulative measures
under a shift) are fixed the same way.
