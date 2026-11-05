- Window and shift measures (RFC 0015): `measure.trailing("revenue", 7, "day")`,
  `measure.to_date("revenue", "month")`, `measure.cumulative("orders")` and
  `measure.shift("revenue", 1, "week")` re-aggregate a base measure along the
  time axis, and derived measures can divide by them for period-over-period
  ratios. A query that selects one needs a `by` grain and exactly one bounded
  range on the time key. It plans one ClickHouse statement that fills every
  bucket and guards the series size, in the query timezone. Client endpoints do
  not advertise these measures, and publishing is refused until deployment
  contract 3, as in TypeScript.
