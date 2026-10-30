# RFC 0024: Filterable dimensions and declared filters

- Status: Proposed
- Version: none (no artifact changes)

A dataset's filterable fields are the union of its declared filters and its
dimensions marked filterable. Declared filters no longer replace the
dimensions as an allowlist.

Before this RFC, a dataset that declared any filter exposed only those
filters. Declaring `plan_filter` on `plan` made every other dimension
unfilterable, and across a relationship only target dimensions with a filter
named exactly after them were reachable. A deployment contract that lists no
filters is rehydrated with an empty map, so it exposed none at all, whatever
its dimensions said. Hosted authoring worked around this by generating a
filter named after every filterable dimension.

## Rule

The filters a caller may apply to a dataset are:

1. every declared filter, under its own name, field and operators; a declared
   filter may expose a dimension marked `filterable: false`;
2. for each dimension with `filterable` not `false` that no declared filter is
   named after, a filter of the same name on that dimension.

A filter from rule 2 takes the operators of the declared filters whose field
is that dimension: the union of their lists when every one has a list, and
the default list otherwise. With no such filter it gets the default list,
which has no null checks (RFC 0023). Naming the dimension directly therefore
cannot bypass a declared narrowing of its operators.

A relationship-qualified filter `rel.field` is allowed when `field` is a
non-SQL dimension of the to-one target and the target's filters under rule 1
or 2 include one named `field` on that field. Declared aliases on other names
stay unreachable through the hop.

The rule applies wherever filters are checked: dataset and metric query
validation, enforced constraints (RFC 0019), relationship filters, the
generated dataset input schema, and the TypeScript filter types.

## What does not change

- Deployment contracts, catalogs and semantic contracts still list only the
  declared filters (or the generated set when none are declared), so contract
  identity and content hashes are unchanged. Consumers apply the rule when
  they read a contract.
- A metric's own `filters` list stays authoritative for its input schema, so
  a hosted catalog can still narrow a metric's filters.
- RFC 0019 visibility marks hidden dimensions non-filterable, so rule 2 never
  exposes one.
- Tenant-key filters under runtime tenancy are still refused.

## Compatibility

Queries accept more filters: one that was refused as an unknown filter field
may now run. A provider that relied on declared filters to hide a dimension
must mark it `filterable: false`. An explicit empty `filters` map no longer
disables filtering. The Python implementation still treats declared filters
as the allowlist and needs the same change to keep parity.
