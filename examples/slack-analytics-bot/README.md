# A Slack analytics bot for your team over ClickHouse

Your team asks data questions in Slack and gets answers from governed datasets over your own ClickHouse. Revenue never lands in a channel that isn't allowed to see it.

## Demo

```text
#product      @hypequery events by type in October 2026
              Page views lead, then API calls and query runs.
              eventType  events
              ---------  ------
              page_view  62,945
              api_call   35,013
              query_run  20,801
              login      11,297
              export      5,478
              error       4,210
              Dataset `events` · Filters: occurredAt between 2026-10-01 and 2026-11-01

#product      (an admin) @hypequery active subscriptions by plan?
              → only the admin sees the answer: #product's ceiling is analyst

#leadership   (an admin) @hypequery active subscriptions by plan?
              → answered in the thread: #leadership's ceiling is admin
```

## Install

```bash
npx @hypequery/cli create slack-analytics-bot -y
cd slack-analytics-bot
docker compose -f ../examples/_seed/docker-compose.yml up -d --wait && pnpm seed   # or set CLICKHOUSE_* for your own ClickHouse
pnpm install
pnpm manifest       # writes slack-app-manifest.json (Socket Mode)
```

Create the Slack app:

1. Open https://api.slack.com/apps?new_app=1, choose **From a manifest**, and paste `slack-app-manifest.json`.
2. Install the app to the workspace.
3. Fill in `.env` from `.env.example`:
   - `SLACK_BOT_TOKEN`: the bot token (`xoxb-…`).
   - `SLACK_APP_TOKEN`: an app-level token with `connections:write`.
   - `SLACK_MEMBERS` and `SLACK_CHANNELS`: who may ask, and each channel's ceiling.

Then run `pnpm dev`.

Socket Mode needs no public URL. For HTTP instead, run `npx hypequery slack init --url https://<host>/slack/events`, set `SLACK_SIGNING_SECRET`, and leave `SLACK_APP_TOKEN` empty.

## What it shows

- **Self-hosted end to end.** The hypequery tools run in the bot's own process over your ClickHouse, with no MCP server, no hypequery Cloud and no token (`@hypequery/agent` with `{ executor }`).
- **Access per person, ceiling per channel.**
  - Analysts get `events`. Admins also get `subscriptions`.
  - A channel's role is the most that may be posted there.
  - When an admin asks in an analyst channel, the answer goes only to them.
  - DMs use the person's own role.
- **Answers you can check.** The table comes from the query result, not from the model's prose. The footer names the dataset and filters.
- **Safe defaults.**
  - People and channels that aren't listed get no answer, and the model is never called for them.
  - Errors go only to the asker.
  - Slack Connect channels are refused.
  - Other people's messages in a thread are marked as context, not instructions.

## Key file: `lib/agent.ts`

```ts
const executors: Record<Role, ReturnType<typeof createMCPExecutor>> = {
  analyst: createMCPExecutor({ datasets: publishDatasets().publish(Events).build(), analytics, businessContext }),
  admin: createMCPExecutor({ datasets: publishDatasets().publish(Events).publish(Subscriptions).build(), analytics, businessContext }),
};

export async function answerQuestion({ text, history, access, signal }: SlackQuestion<Member>): Promise<SlackAnswer> {
  const tools = await hypequeryTools({ executor: executors[access.role] });
  const messages: ModelMessage[] = [
    ...history.map((turn): ModelMessage => turn.role === 'assistant'
      ? { role: 'assistant', content: turn.text }
      : { role: 'user', content: turn.userId === access.slackUserId ? turn.text : `(<@${turn.userId}> wrote) ${turn.text}` }),
    { role: 'user', content: text },
  ];
  const run = await generateText({ model: chatModel(), system: INSTRUCTIONS, tools, messages, stopWhen: stepCountIs(8), abortSignal: signal });
  return answerFromToolResults(run);
}
```

A dataset a role can't see isn't in that role's catalog at all, so no prompt can reach it. Access comes from `lib/team.ts`, never from what a message says.

## Architecture

```text
Slack ──(Socket Mode or /slack/events)──▶ @hypequery/slack
                                           │ verify, ack, once per event
                                           ▼
                                  createSlackBot (src/bot.ts)
                     resolveAccess (lib/team.ts): who, which channel, thread or private
                                           ▼
                                  answerQuestion (lib/agent.ts)
                       AI SDK generateText + hypequery tools for the asker's role
                                           ▼
                             ClickHouse (published datasets only)
```

## Adapt it

- **Your directory.** Replace the env parsing in `lib/team.ts` with your SSO groups or a database. Keep the same shape: a role per person and a ceiling per channel.
- **Your datasets.** Edit `analytics/datasets.ts`, and choose which roles publish which datasets in `lib/agent.ts`.
- **Customer-scoped data.** For a dataset with `tenantKey`, pass `tenantId` to `createMCPExecutor`. It then scopes every query to that tenant.
- **Thread follow-ups in channels.** Generate the manifest with `--thread-history`. That adds `channels:history`, which lets the bot read every message in channels it's in. Without it, channel follow-ups are answered without earlier context. DM threads always have context.
- **Hosted instead.** hypequery Cloud runs the same bot as a Slack app you install, with no server to run.

## Related examples

- [mcp-agent-analytics](../mcp-agent-analytics): the same datasets as a governed MCP server for Claude Code and Cursor.
- [in-app-analytics-agent](../in-app-analytics-agent): a tenant-safe agent inside your own product.
