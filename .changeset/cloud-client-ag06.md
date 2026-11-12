---
"@hypequery/cloud-client": minor
---

New package: a typed client for hypequery Cloud's `/v1` operations, generated from Cloud's `operations-v1.json`. One method per operation with typed input and output, `confirm: true` required on destructive operations, bearer-token auth, and `CloudApiError` carrying Cloud's error envelope (code, hint, retryable, correctable, requestId, issues).
