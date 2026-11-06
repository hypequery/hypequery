- `measure.approx_count_distinct(field)` estimates a distinct count with
  ClickHouse `uniq` (`uniqIf` with measure filters), far cheaper than the exact
  `count_distinct` (`uniqExact`) on large columns. Catalogs and semantic
  contracts mark it, and derived measures that use it, `approximate: true`, as
  TypeScript does; it is duplicate-insensitive through `belongs_to`. Publishing
  it is refused until deployment contract 3, as in TypeScript.
