- Add `hypequery export client-contract --factory module:factory` for offline
  canonical artifacts, including JSON-only stdout, bounded input/output handling,
  read-only drift checks and explicit atomic replacement. Validate both signed
  contracts and prepared identities, redact factory chatter/import failures, and
  preserve concurrent edits and file permissions without importing serving/driver
  extras. The explicitly named project factory should use definition-only SDK APIs.
