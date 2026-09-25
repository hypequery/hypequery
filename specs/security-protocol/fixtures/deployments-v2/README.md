# Deployment contract v2 fixtures

`success.json` holds contracts every implementation must accept, `identity.json`
pins the canonical bytes and SHA-256 of the success case sharing its id, and
`rejections.json` pins a stable failure code for each rule the contract states.

Acceptance of RFC 0006 added the rejection corpus. Before it, the family had one
success and one identity case, which cannot tell a faithful validator from one
that accepts contracts another implementation rejects — the corpus now covers
the envelope's forbidden fields, the null-versus-absent distinction, relationship
and tenant agreement, measure shape, semantic metadata, defaults, endpoint
policy, and derived-measure rules.

Every case was checked against both the TypeScript and Python implementations
before being recorded; none of them changed either implementation's behaviour.
