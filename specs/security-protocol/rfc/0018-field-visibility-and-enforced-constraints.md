# RFC 0018: Field visibility and enforced constraints

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
- **Filters:** a declared filter is visible when the dimension it filters is.
- **Time field:** visible when it is a visible dimension. Grouping by period
  and time measures (window, shift) require it.
- **Measures:** a measure is visible when it is listed and every measure it is
  computed from (a derived measure's `uses`, a time measure's `measure`) is
  visible. A derived value over a hidden input would let a caller recover the
  input.

Visibility only narrows. A dimension the contract marks non-groupable or
non-filterable stays so.

## Enforcement

A data plane that receives a policy MUST:

1. Answer a hidden dataset exactly as a dataset the contract doesn't have
   (`not-found`).
2. Validate the operation against the narrowed field sets, so a hidden field is
   refused with the same message as an unknown one and its existence isn't
   confirmed.
3. Treat an invalid policy as `configuration-invalid`, never as no restriction.

Discovery (tool listings, agent-safe catalogs) MUST use the same resolution. A
projected contract keeps hidden dimensions that measures, relationships or the
tenant key reference, marked neither groupable nor filterable, and drops hidden
measures, filters, and a hidden time field, so it stays valid and advertises
nothing execution would refuse.

## Enforced constraints

A provider may resolve a list of comparisons (RFC 0003) on the dataset's
declared filters or one-hop relationship fields. They:

- are validated against what the contract publishes, not the caller's
  visibility, so a provider may constrain on a field the caller can't see;
- are ANDed after the caller's filters, and don't count toward the caller's
  filter ceiling;
- refuse the call as `forbidden` (`HQ_SEMANTIC_CONSTRAINT_UNENFORCEABLE`) when
  the dataset can't enforce one, with a message that doesn't describe it.

Only plain `field operator literal` comparisons are accepted, like caller
filters.

## Security

Both inputs come from trusted context only. The invocation record has no field
for either, and none may be added, for the reason RFC 0014 gives for the
tenant. A provider that can't resolve a policy it requires MUST refuse the call
rather than run it unrestricted.
