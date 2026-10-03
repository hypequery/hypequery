---
"@hypequery/datasets": minor
---

Add `compileDataset` to preview the same dataset compilation path used by
execution, including effective row limits, pagination overfetch, measure
dependencies and time-axis preflight statements. Structural diagnostics and JSON
serialization omit SQL, parameter values and tenant identifiers.

Add `createPortableSemanticRuntime` for provider-side compilation and execution
over the same activated catalog, and expose a tested capability matrix that
separates protocol representation from TS, Python and Cloud implementation
support. Existing logical SQL and portable executor APIs remain available.
