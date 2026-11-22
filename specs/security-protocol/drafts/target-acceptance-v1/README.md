# Proposed deployment-target acceptance vectors

Owned by Proposed RFC 0030. These cases are draft review evidence, not accepted
conformance fixtures. Don't register this directory in the conformance manifest
until the RFC is accepted.

`accepts.json` holds target `accepts` advertisements. Each `accepted` case
parses to `expected`, with every absent member at its default. A case with no
`value` stands for an absent advertisement. Each `rejected` case fails with
`code` at `path`.

`contract-3-features.json` holds deployment contracts that must validate, and
for each one the datasets that force contract 3 with their features in
registry order (`expected`). A contract 2 case lists none. Every
`deployments-v3` success case appears, along with one dataset that uses every
feature.

`packages/protocol/src/deployment-targets/deployment-targets.test.ts` and
`python/hypequery/tests/test_protocol_target_acceptance.py` run every case.
