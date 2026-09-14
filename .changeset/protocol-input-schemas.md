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

The adapter also learns shape-preserving Zod refinements. A protocol schema
cannot express a cross-field rule such as "at least one dimension or measure",
but the rule remains enforced by the Zod validator the data plane runs.
Transforms and preprocessors remain unsupported because they can change the
output or accepted input shape and would make the advertised contract
inaccurate.
