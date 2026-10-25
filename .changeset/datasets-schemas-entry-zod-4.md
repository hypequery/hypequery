---
'@hypequery/datasets': minor
---

Zod-backed schema builders and agent tools now have their own entry, `@hypequery/datasets/schemas`: `generateDatasetTools`, `toOpenAITools`, `toAISDKTools`, `toMcpTools`, `buildDatasetInputSchema`, `buildMetricInputSchema`, `buildCanonicalSemanticQuerySchemas`, `toSemanticJsonSchema`, `buildDatasetInputProtocolSchema`, `buildMetricInputProtocolSchema`, `zodToProtocolSchema`, `ProtocolSchemaAdapterError` and `buildClientContractQuerySchemas`. Their root-entry re-exports still work and are marked `@deprecated`; 1.0 removes them, and Zod becomes an optional peer dependency needed only by `/schemas`.

Datasets now depends on `zod@^4.6.6` (was `^3.22.4`), which clears GHSA-mrhx-c7xc-m3w5 (memory exhaustion validating oversized arrays). Zod was only used to build datasets' own schemas, so this needs no change from you. The generated JSON Schemas and `manifestHash` are unchanged. Two visible differences: validation messages for an unknown field now list the valid options (`Invalid option: expected one of …` instead of `Invalid enum value`), and `zodToProtocolSchema` accepts schemas from Zod 3 or Zod 4.
