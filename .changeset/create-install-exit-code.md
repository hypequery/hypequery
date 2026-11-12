---
"@hypequery/cli": patch
---

`hypequery create` exits non-zero when the install it was asked to run fails. The scaffold and the `Next:` block with the install command are still written, so a script can tell a half-finished setup from a complete one.
