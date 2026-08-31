---
"@hypequery/cli": patch
---

Protect generated dataset customizations by refusing implicit overwrites, writing replacements atomically with `--force`, and adding non-writing `--check` and `--diff` modes.

Writes without `--force` are exclusive creates, so a file written concurrently is refused instead of clobbered. `--force` replacements preserve the existing file's permissions and never loosen them: the destination's mode is re-read after the replacement is written, and the tighter of the two observations is applied.
