---
"@hypequery/datasets": minor
---

Catalogs and semantic contracts now include each derived measure's inputs (`uses`) and expression, so changing a formula changes the snapshot hash. **Datasets that already declare derived measures report a new semantic contract `contentHash` after upgrading**, including the one Serve's contract endpoint publishes; consumers that compare it to detect definition changes will see one change. Definitions without derived measures are unchanged, as are result-cache keys and deployment contracts. Shared fixtures now pin Python derived-measure authoring to the same deployment and semantic contract output.
