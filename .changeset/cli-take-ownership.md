---
"@hypequery/cli": minor
---

`hypequery deploy` and `hypequery deployment:submit` ask before replacing a live model built in hypequery Cloud, because the project is then managed in code and its model can no longer be edited in Cloud. In a terminal the CLI asks (default no); in CI, pass `--take-ownership`. Deploys now send whether the user agreed, so Cloud refuses a takeover the user didn't confirm. `--take-ownership` can't be combined with `--draft`, which never replaces Production.
