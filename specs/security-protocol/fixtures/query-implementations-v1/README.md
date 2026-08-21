# Query implementation v1 fixtures

This family covers RFC 0005 trusted SQL expressions and the closed named-query implementation kinds.

`success.json` contains accepted structures. `rejections.json` selects either the SQL-expression or implementation surface and pins invalid values, bounded generators, and stable error codes.

Structural validation does not prove SQL is valid or authorize execution. The trusted database adapter owns those checks.
