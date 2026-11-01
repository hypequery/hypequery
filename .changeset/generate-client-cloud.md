---
"@hypequery/cli": minor
---

`hypequery generate:client --cloud` generates typed React routes and types from the live Cloud release of the target chosen with `hypequery login` (or `--project`, `--environment` and `--endpoint` with `HYPEQUERY_API_TOKEN`). The file also exports `clientBaseUrl`, the origin the environment is served from. `deploy --client <path>` regenerates that file after each live publish; if regeneration fails, the deploy still succeeds and the CLI prints the command to retry.
