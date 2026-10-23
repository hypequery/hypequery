# K-08: resolved-row dataset sources

Status: In progress (Codex, 2026-10-23).

Add an explicit portable source policy for ClickHouse FINAL reads on replacing
and collapsing table families. Carry it through dataset definitions and deployment
contract roundtrips; resolve both base and relationship scans before row filters.
Reject unsupported engines, SQL dialects and the frozen semantic backend path.
Aggregating and Summing states are not scalar measures and are outside this policy.

Cloud acceptance remains blocked until compatible Core packages are released and
Cloud upgrades its pinned packages. This branch does not publish packages or alter CI.
