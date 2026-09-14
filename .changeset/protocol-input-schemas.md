---
"@hypequery/datasets": minor
"@hypequery/serve": patch
---

Emit semantic input schemas as `ProtocolSchema`, so a hosted registry stops
rebuilding them.

`buildDatasetInputProtocolSchema` and `buildMetricInputProtocolSchema` return
the same shape `buildDatasetInputSchema` and `buildMetricInputSchema` already
produce, in the protocol's own schema format.

A hosted gateway advertises one endpoint per dataset and per metric, in
`ProtocolSchema`. Without this it has to rebuild that shape by hand — which is a
second generator of the knowledge `CORE-03` exists to keep in one place, and it
drifts silently rather than loudly: an advertised field the validator rejects,
or a row ceiling the data plane does not apply. Deriving both from one catalog
makes that class of bug impossible instead of merely unlikely.

`zodToProtocolSchema` and `ProtocolSchemaAdapterError` move from
`@hypequery/serve` to `@hypequery/datasets`, beside the builders they convert.
`@hypequery/serve` re-exports both, so nothing importing them changes.

The adapter also learns `ZodEffects`, which `.refine()` and `.transform()`
produce. The wrapped shape converts; the effect itself does not, because a
protocol schema describes a value's structure and cannot express a cross-field
rule such as "at least one dimension or measure". Dropping it is safe rather
than lossy in the way that matters: the effect is still enforced by the Zod
validator the data plane runs, so a query breaking the rule is still rejected.
What is lost is only the ability to *advertise* the rule — and refusing to
convert at all, which is what happened before, lost the entire schema instead.
