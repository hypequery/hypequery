# Changelog

## Unreleased

- Bind timestamp parameters as Unix seconds. RFC 3339 filter values such as
  `2026-10-25T01:30:00Z` were rejected by ClickHouse, and aware datetimes could
  resolve to the wrong instant on a non-UTC server in a repeated daylight-saving
  hour. Values without an offset are passed through unchanged.
