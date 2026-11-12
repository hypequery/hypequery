---
"@hypequery/cli": minor
---

Add `hypequery examples list [--json] [--kind example|recipe|guide]` and `hypequery create <slug> [-y] [--dir] [--no-install] [--no-seed] [--tag]`.

`examples list` prints the registry behind hypequery.com/examples (or its JSON index). `create` scaffolds an example or recipe into `./<slug>` with a blobless sparse `git` checkout, pins `workspace:*` dependencies to the published versions the example was tested with (falling back to a dist-tag when a version is not on npm yet), copies the shared seed dataset into `./<slug>/seed`, installs dependencies, and always ends with a `Next:` block. No account, no prompts with `-y`, non-zero exit on failure. Set `HYPEQUERY_EXAMPLES_INDEX` to a URL or file to use another index.
