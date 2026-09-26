---
'@hypequery/protocol': minor
'@hypequery/protocol-conformance': minor
---

Add deployment contract 3 (RFC 0015) through `validateProtocolDeploymentContractV3` and `prepareProtocolDeploymentContractV3`, with identity domain `hypequery:deployment:v3\0`. Contract 3:

- renames the dataset filter allow-list to `allowedFilters`;
- adds dataset `segments`, whose predicates compare the dataset's own dimensions with literals;
- accepts `approxCountDistinct` measures with a required `approximate` marker, which derived measures inherit;
- allows `minute`/`hour` default grains.

A contract 3 envelope that uses none of these is rejected, because it must be published as contract 2 (the lowest-version rule). Contract 2 validation and identities are unchanged. The conformance corpus gains the `deployments-v3` family.
