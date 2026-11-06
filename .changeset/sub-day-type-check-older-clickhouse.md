---
"@hypequery/datasets": patch
---

Sub-day window and shift queries run on ClickHouse 25.x. The time-column type check selected an empty row tuple as a scalar, which servers before 26 refuse; it now selects the time element.
