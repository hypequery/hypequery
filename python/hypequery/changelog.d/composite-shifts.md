- `measure.shift` can wrap a window, a derived measure or another shift, as in
  TypeScript: a prior-year year-to-date, a shifted average order value, or
  `shift(shift(x))`. The wrapped measure is recalculated over the earlier
  interval, and shifted formulas divide shifted aggregates. Derived measures
  over derived measures that read windows or shifts are now planned too,
  instead of refused. Definitions reject dependency cycles through shifts and
  formulas, and catalogs report the grains both the shift and its input
  support.
