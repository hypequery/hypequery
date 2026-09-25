---
"@hypequery/protocol": patch
---

Reject an unpaired high surrogate at the end of a string during canonical value validation. Previously `validateCanonicalValue("\ud800")` was accepted, and such a string encodes to the same UTF-8 bytes as `"�"`.
