---
"@hypequery/clickhouse": patch
---

Fix the CLI declaration re-export to use an explicit `.js` extension, so importing the package root or CLI entry point passes NodeNext and Node16 type checking with `skipLibCheck: false` and preserves schema-generator types.
