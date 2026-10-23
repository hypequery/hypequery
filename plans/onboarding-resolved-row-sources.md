# K-08: resolved-row dataset sources

Status: In review ([Core #746](https://github.com/hypequery/hypequery/pull/746), Codex, 2026-10-23).

Add an explicit portable source policy for ClickHouse FINAL reads on replacing
and collapsing table families. Carry it through dataset definitions and deployment
contract roundtrips; resolve both base and relationship scans before row filters.
Reject unsupported engines, SQL dialects and the frozen semantic backend path.
Aggregating and Summing states are not scalar measures and are outside this policy.

Cloud acceptance remains blocked until compatible Core packages are released and
Cloud upgrades its pinned packages. This branch does not publish packages or alter CI.

Implementation: explicit `rowResolution` FINAL policy for replacing and both
collapsing families, strict portable grammar in TypeScript and Python, contract
roundtrip/cache identity, shared resolved source scans and backend/dialect refusal.
See RFC 0020 for authoring and connection requirements. Package publication and
Cloud dependency upgrades remain separate work; no CI configuration changed.

Validation: protocol 819 + datasets 1,784 + deployment 157 + serve 599 unit tests;
seven real ClickHouse 26.3 reconciliation tests (including readonly=2); datasets
type tests, workspace lint/types, TypeScript and Python protocol conformance and
98 Python deployment tests pass. Cloud acceptance awaits package publication
and dependency upgrades; no package was published.
