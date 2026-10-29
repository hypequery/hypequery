---
'@hypequery/protocol': patch
'@hypequery/cli': patch
---

Name the field when a client contract has one this version doesn't know. `ProtocolClientContractError.path` for `HQ_CLIENT_UNKNOWN_FIELD` now points at the unknown member (for example `/endpoints/0/annotations`) instead of its parent object, and `hypequery generate:client` reports that path and suggests upgrading `@hypequery/cli`, since the contract usually comes from a newer hypequery.
