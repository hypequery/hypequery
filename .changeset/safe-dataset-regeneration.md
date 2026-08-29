---
"@hypequery/cli": patch
---

Protect generated dataset customizations by refusing implicit overwrites, writing replacements atomically with `--force`, and adding non-writing `--check` and `--diff` modes.

Writes without `--force` are exclusive creates, so a file written concurrently is refused instead of clobbered, and `--force` replacements preserve the existing file's permissions.
