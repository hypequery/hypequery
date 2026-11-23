---
'@hypequery/cli': minor
---

`hypequery deploy` and `hypequery deployment:submit` check the deployment against the versions the Cloud target accepts before uploading anything (RFC 0030). The CLI reads `accepts` from the target's live state. When the bundle's deployment contract or bundle manifest version isn't accepted, it fails with `DEPLOYMENT_VERSION_UNSUPPORTED` and names the target's accepted versions and each dataset's forcing features (for example `orders uses alternate time keys`). It never lowers the version to fit. A target that advertises nothing accepts contract 2, invocation 1 and bundles 1 and 2. An endpoint with no state resource, and `--draft` uploads, are left to the target's intake.

Consumer-breaking: hypequery Cloud must return `accepts.deploymentContract` including `3` in `GET /v1/deployments/targets/{project}/{environment}/state` before this CLI uploads a contract 3 deployment (segments, window or shift measures, `approxCountDistinct`, a sub-day default grain or alternate time keys). Until then such deploys fail before upload instead of at Cloud's intake.
