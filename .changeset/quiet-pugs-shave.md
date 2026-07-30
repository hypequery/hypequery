---
"@hypequery/cli": patch
---

Fix two `hypequery init` defects found while regression-testing the interactive flow.

**Ctrl+C now aborts.** `prompts.override({ onCancel })` was a no-op — `override` maps question *names* to pre-supplied answers, not options — so an aborted prompt was indistinguishable from an unanswered one and each caller's `?? default` answered on the user's behalf. Pressing Ctrl+C at every prompt still scaffolded a full project and printed "Setup complete!". Prompts now receive a real `onCancel` handler that raises `PromptCancelledError`, which the CLI reports as `Cancelled.` and exits `130`.

**chDB scaffolding works on the canary channel.** Canary builds pin siblings to `0.0.0-canary-*`, which cannot satisfy `chdb`'s `peerOptional @hypequery/clickhouse@">=2.1.2"`, so npm aborted the scaffold install with `ERESOLVE` and `hypequery init --database chdb` ended with "chdb is not installed". Canary installs on npm now pass `--legacy-peer-deps`; stable installs and other package managers are unchanged.
