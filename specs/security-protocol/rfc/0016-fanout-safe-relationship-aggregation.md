# RFC 0016: Fan-out-safe relationship aggregation

- Status: Proposed
- Date: 2026-10-04
- Tracking: HQ-81
- Proposed versions: expression extension 3, deployment contract 4,
  semantic invocation 3 (allocation subject to acceptance)
- Amends on acceptance: RFC 0003, RFC 0006, RFC 0014, RFC 0015

## Purpose and status

Allow explicitly enabled one-hop relationship aggregation without repeating
owner rows. RFC 0015 forbids measures across hasMany and duplicate-sensitive
aggregates across belongsTo. This proposal does not change that accepted rule.
No runtime or producer may claim these versions from this draft. The associated
[design and SQL proof](../../../plans/datasets-fanout-safe-joins.md) are review
evidence, not protocol conformance.

## Proposed representation

Deployment contract 4 would add these optional closed fields:

- Dataset `primaryKey`: a non-empty array (maximum 100) of distinct physical
  simple identifiers. Every component is non-NULL. The complete tuple uniquely
  identifies each source row, including its tenant when needed. Arrays retain
  authored order in canonical bytes.
- Relationship `aggregation`: the literal `"deduplicate"`. Absence preserves
  existing relationship semantics. Unknown values are rejected. The base and
  target dataset must both declare primary keys. This mode may be declared only
  on belongsTo and hasMany; hasOne retains its existing declaration semantics.

The mode is authored in the contract, never supplied by a query caller. New
qualified dimensions, filters and measure names retain their existing syntax,
but resolution in expression extension 3 permits opted-in traversal. Existing
containers must not reinterpret their inputs under this rule. Producers choose
the lowest supported container version for both contracts and invocations;
invocation 3 is required when a request traverses a deduplicate relationship,
even if its selected aggregates happened to be safe in extension 2. Resolution
therefore needs the activated contract when selecting the invocation version.

Contract 4 retains allowedFilters and the contract 3 grammar, except these
explicit additions. Its proposed identity domain is `hypequery:deployment:v4\0`;
invocation 3 uses its own versioned identity domain following RFC 0014. Canonical
identity fixtures and exact invocation domain must be pinned on acceptance.
Old artifacts remain byte-identical; old parsers fail closed on new versions.

## Proposed population semantics

Each aggregate belongs to exactly one dataset. Select base rows under base
tenant scope, segments and query filters; relationship query predicates use the
same target filter allowlist and tenant-field restrictions as existing to-one
queries. Each target is independently scoped by trusted runtime tenancy.

After expansion and query predicates, define one population per output group
and aggregate owner: the set of owner's primary-key tuples reached in that
group. Aggregate the corresponding original owner rows once each. Value equality
does not establish row identity. A target belongsTo sum over five orders counts
the reached customer once, not five times. A parent sum grouped by two child
categories counts that parent once in each category. Grand totals are separate
population evaluations; summing grouped results is not equivalent.

Fixed measure filters apply to that measure's owner rows after membership is
determined. They do not restrict other measures or remove groups. Approximate
aggregates keep their existing approximation marker and value semantics.

Unmatched parents survive LEFT expansion without a qualified query predicate.
Their target dimension values are NULL regardless of the backend's join default
settings. Unmatched targets never contribute synthetic values. NULL join-key
components never match; NULL group values compare as the same group. Missing
counts are 0 and missing non-count values are NULL. An empty ungrouped
query returns one scalar row with those values; an empty grouped query returns
no groups.

The first runtime capability supports one traversed opted-in relationship,
physical dimensions, and base sum/count/avg/min/max/exact or approximate distinct
counts. Other aggregate kinds, SQL expressions, time bucketing, windows/shifts,
multiple traversed relationships and multi-hop paths must fail explicitly until
a later capability is specified and tested. Envelope representation is not a
claim that a runtime supports execution (RFC 0009).

## Safety obligations

Non-NULL and uniqueness checks must use the same source population as result
evaluation. A declaration, MergeTree ordering key, or independent earlier scan
is insufficient. Runtimes lacking snapshot-safe validation must refuse the
capability. Do not choose an arbitrary row for duplicate primary keys.

Runtime policy must bound intermediate expansion, memory and elapsed time and
propagate cancellation; output limits alone do not bound expansion. Tenant
isolation applies before key checks and membership, including multi-tenant
runtime scopes. Public catalogs expose logical queryability, not physical keys,
private assertions or tenant predicates. Full authenticated deployment contracts
retain execution metadata.

## Rejections and conformance work on acceptance

Pin failures for empty/duplicate/unsafe primary-key columns, missing owner keys,
unknown mode values, invalid relationship kinds, unknown fields and unsupported
version selection. Deployment shape failures use existing HQ_DEPLOYMENT codes;
exact paths and validation order must be finalized with fixtures. Execution
rejections for NULL/duplicate keys, unsupported combinations and exceeded
intermediate budgets must identify the rule without returning sensitive values.

Draft execution rows live in `drafts/fanout-safe-aggregation-v1`. They do not
enter the conformance manifest. On acceptance add canonical contract/invocation
fixtures, unchanged legacy identity cases, cross-language validation and owner
population execution cases. A runtime must pass all cases for its announced
capability, not just decode the new fields.

## Open acceptance gates

1. Select and prove a ClickHouse snapshot/materialization strategy that lets key
   assertions and aggregation observe the same rows under concurrent writes.
2. Pin intermediate budgets and the capability negotiation/failure contract.
3. Allocate versions and pin validation order, exact invocation identity domain,
   version-selection API and canonical fixture bytes.
4. Confirm NULL/no-match results and restrictions across TypeScript, Python and
   portable runtime implementations before advertising the capability.
