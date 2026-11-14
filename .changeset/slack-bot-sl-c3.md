---
"@hypequery/slack": minor
---

`createSlackBot({ slack, resolveAccess, answer })` runs the question → answer flow: it shows the assistant status, passes thread history, posts the rendered answer and handles errors. Access follows a channel ceiling. `resolveAccess` decides whether an answer goes in the thread or privately to the asker (ephemeral or DM), and `channelCeiling()` implements the rule. DMs use the member's own access. Denials and errors reach only the asker, and errors never show raw exception text. Slack Connect channels are refused unless `allowSharedChannels` is set. `answerFromToolResults(run)` builds an answer from an AI SDK `generateText` result, taking the table and its source (dataset and filters) from the last successful query tool. It doesn't depend on the AI SDK.
