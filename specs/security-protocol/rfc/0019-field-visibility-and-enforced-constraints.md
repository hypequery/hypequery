# RFC 0019: Field visibility and enforced constraints

- Status: Proposed
- Version: field visibility 1

## Summary

A provider can narrow what one principal sees of an activated deployment, below
the dataset level, and enforce filters the principal didn't choose. Hosted
embedded analytics needs both: a customer's end user may see shipment counts but
not freight cost, and only their own account's rows.

Neither changes the deployment contract or the semantic invocation. Both are
resolved by the provider inside trusted execution context, like the tenant
(RFC 0014): a caller can't supply or change them.

## Visibility record

```json
{
  "kind": "hypequery-field-visibility",
  "version": 1,
  "datasets": {
    "shipments": { "dimensions": ["carrier", "region"], "measures": "*" }
  }
}
```

An allowlist. A dataset absent from `datasets` is hidden. `"*"` exposes every
field of that kind, including ones a later release adds; a list exposes only the
named fields. Names are portable identifiers (RFC 0002), unique within a list,
at most 1,024 per list and 256 datasets. Unknown keys fail closed. Names the
contract doesn't have are ignored, so a policy outlives the removal of a field.

## Resolution

For one dataset under a policy:

- **Dimensions:** the listed local dimensions, plus `relationship.dimension`
  for each relationship whose target dataset is visible, limited to the
  dimensions visible in the target's own entry.
- **Relationships:** visible only when the target is visible and every local
  join key (`from`, and each `keys[].from`) is a visible dimension or the
  source column of one. A joined `to` field holds the key's values, so a
  visible join over a hidden key would read the key back.
- **Filters:** a declared filter is visible when the dimension it filters is.
- **Time field:** visible when it is a visible dimension. Grouping by period
  and time measures (window, shift) require it.
- **Measures:** a measure is visible when it is listed and every measure it is
  computed from (a derived measure's `uses`, a time measure's `measure`) is
  visible. A derived value over a hidden input would let a caller recover the
  input. Measures are otherwise authorized by name, independently of the
  dimensions they aggregate: `revenue = sum(amount)` stays visible with
  `amount` hidden. Because `min`, `max`, `argMax`, `argMin` and
  `countDistinct` over a hidden dimension reveal its values, providers SHOULD
  list measures rather than use `"*"` when any must stay hidden; `"*"` also
  exposes measures added later.
- **Segments** are not narrowed. Deployment contract 2 has none; a later
  extension that adds them must hide a segment whose condition references a
  hidden field.

Visibility only narrows. A dimension the contract marks non-groupable or
non-filterable stays so.

## Enforcement

A data plane that receives a policy MUST:

1. Answer a hidden dataset exactly as a dataset the contract doesn't have
   (`not-found`), before endpoint access and tenant checks, so no other
   outcome distinguishes it and no tenant is resolved for it.
2. Validate the operation against the narrowed field sets, so a hidden field is
   refused with the same message as an unknown one and its existence isn't
   confirmed.
3. Treat an invalid policy as `configuration-invalid`, never as no restriction.

Discovery (tool listings, agent-safe catalogs) MUST use the same resolution. A
projected contract keeps hidden dimensions that measures, relationships or the
tenant key reference, marked neither groupable nor filterable and stripped of
labels, descriptions and semantic metadata. It drops hidden measures, filters,
a hidden time field, and relationships that aren't visible (with any dataset
only they required), so it stays valid and the agent-safe catalog built from
it advertises nothing execution would refuse. The projected contract still
names concealed dimensions and their sources, so it is not itself safe to
show to the principal.

## Enforced constraints

A provider may resolve a list of comparisons (RFC 0003) on the dataset's
declared filters or one-hop relationship fields. They:

- are validated against what the contract publishes, not the caller's
  visibility, so a provider may constrain on a field the caller can't see;
- are ANDed after the caller's filters, at most 32 per call;
- count toward the dataset's filter ceiling, since executors apply them as
  filters. The caller's own allowance is reduced by their number, and a
  dataset whose ceiling can't fit them refuses the call;
- refuse the call as `forbidden` (`HQ_SEMANTIC_CONSTRAINT_UNENFORCEABLE`) when
  the dataset can't enforce one, with a message that doesn't describe it.

Only plain `field operator literal` comparisons are accepted, like caller
filters.

## Security

Both inputs come from trusted context only. The invocation record has no field
for either, and none may be added, for the reason RFC 0014 gives for the
tenant. A provider that can't resolve a policy it requires MUST refuse the call
rather than run it unrestricted.
