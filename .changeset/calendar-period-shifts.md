---
"@hypequery/datasets": minor
---

Support calendar month, quarter, and year shifts at finer query grains. Clamp
missing dates to the target month's last day, preserve full bucket widths and
partial local endpoints, and exclude unmapped source buckets from dimension
populations. Catalog grain metadata uses the same validation rules.
