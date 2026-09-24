---
"@hypequery/datasets": patch
---

An "Unexpected character" issue for an emoji or other astral character now names the whole character and spans both of its UTF-16 code units. Previously it quoted half a surrogate pair.
