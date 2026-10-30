---
'@hypequery/protocol': patch
'@hypequery/cli': patch
---

Name the field when a client contract has one this version doesn't know. `ProtocolClientContractError` gains an optional `field`: for `HQ_CLIENT_UNKNOWN_FIELD`, the first unknown member at `path` (whose value, the parent object, is unchanged). `hypequery generate:client` reports where it is (for example `/endpoints/0/annotations`) and suggests upgrading `@hypequery/cli`, since the contract usually comes from a newer hypequery.
