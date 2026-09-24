---
"@hypequery/protocol": patch
---

Reject a string whose last UTF-16 code unit is an unpaired high surrogate. The bounds check read one unit past the end, where `charCodeAt` yields `NaN` and compares false against both ends of the low-surrogate range, so such a string was accepted where the Python implementation rejects it.
