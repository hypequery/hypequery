---
"@hypequery/cloud-client": minor
---

Regenerated from Cloud's latest `operations-v1.json`: 92 operations, adding `organization.update` (`PATCH /org`, with `ORGANIZATION_SLUG_TAKEN`), members (`changeRole`, `remove`), customer access (signing keys, customer app listing), `logs.get`, `drafts.evidence` and `drafts.replay` (a `POST`), `managementTokens.list` and `.revoke`, and `feedback.create`, with their error codes. Some of these operations are still in review in Cloud and may change before they ship there. Path parameters of `.` or `..` are refused before sending, since URL parsing would resolve them to another route.
