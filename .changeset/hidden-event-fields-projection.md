---
'@hypequery/deployment': patch
---

The authorized contract projection no longer breaks discovery when a visibility policy hides a field an event dataset's `events` declaration names (RFC 0027, RFC 0019). Before, the narrowed contract kept `events` pointing at the hidden entity, event dimension or time field, its own validator rejected it, and the caller got no catalog. Now a hidden entity or time field drops `events`, so the dataset stays discoverable without event operations for that caller. A hidden event dimension narrows the declaration to `{ entity }`. A dataset retained only to support a join no longer carries `events`.
