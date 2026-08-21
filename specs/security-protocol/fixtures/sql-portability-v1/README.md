# SQL portability v1 fixtures

- `portable.json` maps accepted SQL expression fragments to RFC 0003 expression trees and sorted dependencies.
- `non-portable.json` maps unsupported input to the first issue code and source offset.

The portable subset covers identifiers, literals, arithmetic, comparisons, literal `IN` lists, literal `BETWEEN`, `LIKE`, boolean logic, parentheses, and the approved formula functions. Statements, subqueries, casts, lambdas, comments, unapproved functions, and dynamic list/range operands remain non-portable by construction.
