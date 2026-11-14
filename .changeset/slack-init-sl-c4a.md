---
"@hypequery/cli": minor
"@hypequery/slack": minor
---

`hypequery slack init (--url <https url> | --socket)` writes a Slack app manifest for a hypequery analytics bot and prints the setup steps. `buildSlackManifest()` in `@hypequery/slack` builds the same manifest. It asks only for the scopes `createSlackBot()` needs (`app_mentions:read`, `assistant:write`, `chat:write`, `im:history`, `im:read`, `im:write`) and subscribes to `app_mention`, `message.im`, `assistant_thread_started`, `app_uninstalled` and `tokens_revoked`. Reading channel threads for follow-up context adds `channels:history` and `groups:history`, which let the bot read every message in channels it is added to, so it is opt-in (`--thread-history` / `channelThreadHistory`). Without those scopes, `createSlackBot()` now answers without thread context instead of failing.
