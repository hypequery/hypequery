# @hypequery/slack

Slack transport and Block Kit rendering for hypequery analytics agents.

```bash
npm install @hypequery/slack
```

This package handles the Slack side of a bot that answers analytics questions:
verifying requests, normalizing events, acking within Slack's 3 seconds, and
rendering answers as Block Kit. You bring the agent. The tools come from
`@hypequery/agent`, either in process over your own ClickHouse or against
hypequery Cloud.

There are no runtime dependencies. Signatures use Web Crypto and the Web API
uses `fetch`, so it runs on Node.js 20+, Deno, Bun, Cloudflare Workers and
Vercel Edge.

## HTTP (Events API)

```ts
import { createSlackClient, createSlackRequestHandler, renderSlackAnswer } from '@hypequery/slack';
import { after } from 'next/server';

const slack = createSlackClient({ token: process.env.SLACK_BOT_TOKEN! });

const handler = createSlackRequestHandler({
  signingSecret: process.env.SLACK_SIGNING_SECRET!,
  waitUntil: work => after(work),
  async onEvent(event) {
    if (event.kind !== 'question') return;
    const answer = await askYourAgent(event.text);   // your agent loop
    await slack.postMessage({ channel: event.channelId, thread_ts: event.threadTs, ...renderSlackAnswer(answer) });
  },
});

export const POST = handler;   // app/slack/events/route.ts
```

The handler:

- rejects requests without a valid `X-Slack-Signature`, or with a timestamp more than 5 minutes off;
- answers `url_verification`;
- returns `200` at once and runs your handler afterwards. Pass your platform's `waitUntil` (Next.js `after`, Vercel `waitUntil`, Workers `ctx.waitUntil`) so serverless platforms don't freeze the work;
- runs each event id once, so Slack's retries don't post twice. The default dedupe is in memory. With several instances, pass `dedupe` backed by a shared store;
- leaves out events the bot shouldn't act on: messages from bots or from itself, edits, and channel messages that don't mention it.

Point the Event Subscriptions, Interactivity and Slash Commands Request URLs at
the same route. `onInteraction` and `onCommand` receive those.

## Socket Mode (no public URL)

```ts
import { createSocketModeClient } from '@hypequery/slack';

const socket = createSocketModeClient({
  appToken: process.env.SLACK_APP_TOKEN!,   // xapp-…, scope connections:write
  onEvent: handleEvent,
});
await socket.start();
```

Socket Mode acks every envelope before running handlers, and reconnects with
backoff when Slack refreshes the connection. On Node.js 20, pass
`WebSocket` from the `ws` package. Node.js 22+ has a global one.

## Events

`onEvent` receives one of:

| `kind` | When |
| --- | --- |
| `question` | `@bot` in a channel (`source: 'mention'`) or a message in the bot's DM or assistant pane (`source: 'dm'`). `text` has the bot mention removed. Reply in `threadTs`. `isExtSharedChannel` marks Slack Connect channels. |
| `assistant_thread_started` | A user opened a new assistant thread. A good moment for `setSuggestedPrompts`. |
| `app_uninstalled`, `tokens_revoked` | Delete the workspace's stored tokens. |

Every event carries `eventId`, `teamId`, `enterpriseId` and the bot's own `botUserId`.

## Rendering answers

```ts
renderSlackAnswer({
  title: 'Revenue by region',
  text: 'EU leads with **$1.2M**, up 12% week on week.',      // Markdown → mrkdwn
  table: queryResultToTable(toolResult),                       // { data, meta } from query_dataset
  source: { dataset: 'orders', filters: ['last 7 days'], requestId },
  link: { url: answerUrl, label: 'Open in hypequery' },
});
// → { text, blocks } for chat.postMessage
```

- Tables are rendered as aligned monospace text. Numbers are right-aligned and use the locale's digit grouping. A table is cut to fit in one section, with a "Showing N of M rows" note.
- Every value is escaped (`&`, `<`, `>`), so model output and data can't produce `@channel`, user mentions or links. Only `http(s)` links are kept.
- Output stays within Block Kit limits: 50 blocks, 3000 characters per section and 150 per header.
- SQL is shown only with `{ showSql: true }`.

`renderSlackError({ message, hint, requestId })` renders a short error reply.
Pass a message written for the user, never raw exception text.

## Web API

`createSlackClient({ token })` has `postMessage`, `postEphemeral`, `updateMessage`,
`setAssistantStatus`, `setSuggestedPrompts`, `setThreadTitle`, `threadReplies`
(paginated) and `call(method, args)` for anything else. It waits out `429`
responses using `Retry-After`. Failures throw `SlackApiError` with Slack's `code`.

## Security notes

- Keep the signing secret and bot token server-side.
- Treat thread history as untrusted input. Another person's message in the thread can try to steer your agent. Run queries with the asker's access, never with access granted by anything inside a message.
- A reply in a channel is visible to everyone in it. Decide what access a channel gets, and send answers that need more access privately (`postEphemeral` or a DM).
