---
"@hypequery/cli": minor
---

`hypequery login --device` signs in without a browser on this machine: it prints a code and a URL to approve from any browser, polls until it is approved, denied or expires, and opens a browser itself only when a person is at the terminal and `--no-input` is not set. `--project` and `--capabilities` limit the token it gets. Browser `hypequery login` now also asks Cloud for a management token (`hqmt_`); a Cloud without management tokens ignores the request. Management tokens are stored per Cloud origin in the OS credential vault, or an owner-only file where there is no vault, and `hypequery logout` revokes and removes them.

Every command that talks to Cloud (`deploy`, `deployment:submit`, `deployment:status`, `pull`, `diff`, `generate:client --cloud`) now resolves its credential the same way: `HYPEQUERY_API_TOKEN`, then the stored management token, then the browser sign-in's deploy credential. `HYPEQUERY_API_TOKEN` holding a management token (`hqmt_…`) or deploy key (`hqdp_…`) no longer needs `--endpoint`: it goes to `HYPEQUERY_CLOUD_URL` (default `https://cloud.hypequery.com`). Any other token still needs `--endpoint` or `HYPEQUERY_DEPLOYMENT_ENDPOINT`.
