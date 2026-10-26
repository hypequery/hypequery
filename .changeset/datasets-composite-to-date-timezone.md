---
'@hypequery/datasets': patch
---

Fix to-date measures returning `null` on every row in a non-UTC query timezone when they are reached through a nested derived measure (the composite time-measure plan). The to-date start is now kept in the query timezone instead of the server's.
