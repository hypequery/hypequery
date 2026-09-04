---
"@hypequery/serve": minor
"@hypequery/cli": minor
---

Fail a deployment build when the Serve configuration would behave differently under managed execution. Unenforceable tenant isolation and dropped middleware block the build; dropped hooks, dropped context factories, and endpoints that are authenticated without declared roles or scopes are reported as warnings. Pass `--allow-unsupported-config` to deploy anyway.
