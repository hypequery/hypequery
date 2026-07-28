---
"@hypequery/cli": minor
---

Add a one-command deployment workflow that builds, prepares, and submits an API
module, while exposing prebuilt uploads through `deployment:submit`.

`hypequery deploy <api-module>` now orchestrates build → release → submission,
and resolves the Cloud endpoint and token before building so a missing or
expired login fails immediately instead of after a full bundle build.

`hypequery deploy <bundle> --release <file>` still works but is deprecated and
now prints a warning. Use `hypequery deployment:submit <bundle> --release
<file>` instead.
