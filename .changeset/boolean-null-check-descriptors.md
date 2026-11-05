---
"@hypequery/datasets": patch
---

Client contracts built from a deployment keep `isNull` and `isNotNull` on boolean filters that allow them, as RFC 0023 specifies. They were previously dropped, so a boolean filter allowing only null checks disappeared from the contract.
