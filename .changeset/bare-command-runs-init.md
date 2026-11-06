---
"@hypequery/cli": minor
---

Running `hypequery` with no command in an interactive terminal now starts `hypequery init` instead of printing help, so `npx hypequery` takes new users straight into setup. A one-line hint points to `hypequery --help` for the full command list. When the CLI is not attached to a terminal (scripts, CI, piped input), the bare command still prints help and exits with code 1, so nothing waits on a prompt.
