---
"@hypequery/clickhouse": patch
---

Arrow streams work for `readonly = 1` users and catch mid-stream failures on servers before ClickHouse 25.11.

- `streamArrow()` and `rawArrowStream()` request the format with a `FORMAT ArrowStream` clause instead of the `default_format` setting, which `readonly = 1` users may not change. A trailing `;` or comment is dropped first, and a statement that already ends in another `FORMAT` is refused before it is sent.
- The uncompressed-batches default (`output_format_arrow_compression_method = 'none'`) is still sent, and a `readonly = 1` user accepts it when its profile already sets that value. When ClickHouse rejects it, the error explains the fix. The new `arrowCompression: 'server-default'` adapter option leaves the setting out, so batches use the server's compression method.
- Detecting a mid-stream failure from its tagged exception block needs ClickHouse 25.11 or later, because older servers send no `X-ClickHouse-Exception-Tag`. An Arrow stream from any server now also errors when its bytes end without Arrow's end-of-stream marker, so a failed or truncated stream no longer looks complete. On older servers, ClickHouse's error message is recovered from the response where possible.
