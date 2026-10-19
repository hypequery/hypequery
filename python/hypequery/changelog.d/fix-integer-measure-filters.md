- Fix deployment of measure filters with integer values, such as
  `filter.gte("amount", 10)`, which failed with `HQ_VALUE_INTEGER_TAG_REQUIRED`. An
  exactly representable integer now publishes as the same binary64 number TypeScript
  writes, with an identical deployment identity. Integers beyond 2**53 are refused with
  a clear error rather than rounded.
