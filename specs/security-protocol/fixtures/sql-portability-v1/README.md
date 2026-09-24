# SQL portability v1 fixtures

- `portable.json` maps accepted SQL expression fragments to RFC 0003 expression trees and sorted dependencies.
- `non-portable.json` maps unsupported input to the first issue code and source offset.

Source offsets are zero-based and counted in UTF-16 code units, so a character outside the Basic Multilingual Plane (such as an emoji) advances every later offset by two. This is the unit JavaScript strings and most editors use; implementations whose native strings index by code point must convert.

The portable subset covers identifiers, literals, arithmetic, comparisons, literal `IN` lists, literal `BETWEEN`, `LIKE`, boolean logic, parentheses, and the approved formula functions. Statements, subqueries, casts, lambdas, comments, unapproved functions, and dynamic list/range operands remain non-portable by construction.
