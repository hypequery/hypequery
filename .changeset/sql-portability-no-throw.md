---
"@hypequery/datasets": patch
---

`compilePortableSqlExpression` now reports every non-portable input as an issue instead of throwing `ProtocolExpressionError`. The inputs that previously threw were LIKE patterns that aren't string literals, arithmetic chains deeper than 16 levels, AND/OR chains with more than 100 operands, IN lists of negative numbers past the node limit, and string literals with control characters or unpaired surrogates.
