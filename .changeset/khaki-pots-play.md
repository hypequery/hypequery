---
"@hypequery/serve": patch
---

Coerce GET query-string values against the endpoint's input schema before
validating.

Query strings carry no types, so every value arrives as a string. A field
declared `z.number()` therefore always failed:

```
GET /api/analytics/queries/busiestRoutes?minTrips=500&limit=8
→ 400 { "code": "invalid_type", "expected": "number",
        "received": "string", "path": ["limit"] }
```

That made GET endpoints unusable for any input that was not itself a string —
including through `@hypequery/react`, whose client serialises GET input as flat
query params.

Values are now converted toward what the schema declares: numbers, booleans,
bigints, and dates. Strings and enums are untouched. A repeated key becomes an
array, and a single occurrence of a key typed as `z.array(...)` is wrapped into
one.

Coercion is conservative and never invents a value. Anything it cannot convert
passes through unchanged so validation still reports the genuine error —
`?limit=abc` continues to fail with `expected number, received string`, and
`?limit=5000` is coerced and then correctly rejected by `.max(100)`.

POST bodies are unaffected; JSON already carries types, so a body value of `"5"`
stays a string.
