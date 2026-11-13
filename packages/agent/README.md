# @hypequery/agent

Put a hypequery Cloud project's tenant-safe analytics in your own agent: mint
end-user tokens in your backend, then give your agent the project's tools.

```bash
npm install @hypequery/agent
```

## Mint a token

Put a hypequery Cloud project's tenant-safe analytics in your own agent.

`mintAgentToken()` signs an end-user token in your backend with a project's
managed signing key. It makes no network call, so you can mint one per
session or per request. The tenant comes from the signed token, never from the
model, so a prompt can't reach another customer's data.


```ts
import { mintAgentToken } from '@hypequery/agent';

// In your backend, when a session starts.
const { token, mcpUrl, expiresAt } = await mintAgentToken({
  signingKey: process.env.HYPEQUERY_AGENT_KEY!,
  tenant: session.orgId,
  subject: session.userId,
  permissionSet: 'customers',
});

// Any MCP client: send the token as a bearer token to mcpUrl.
```

### Options

| Option | |
| --- | --- |
| `signingKey` | The private key JSON Cloud showed when you created the key (Settings → Customer access → Signing keys for in-app agents). Keep it in `HYPEQUERY_AGENT_KEY`. |
| `tenant` | The end user's customer. Every query is scoped to it. |
| `subject` | The end user, as your app identifies them. |
| `permissionSet` | The permission set the end user acts with, by name. Required. |
| `constraints` | Optional filters every query carries: `{ filter, operator: 'eq', value }` or `{ filter, operator: 'in', value: [...] }`, at most 8. |
| `expiresInSeconds` | Lifetime, 1 to 900. Defaults to 900 (15 minutes, Cloud's ceiling). |
| `project` | Optional. The project's protocol name (for example `acme:logistics`). Defaults to the key's `hq_project`. |
| `endpoint` | Optional. The project's customer endpoint, `https://<endpoint>.hypequery.app`, or its `/mcp` URL. Defaults to the key's `hq_endpoint`. https only, except on localhost. |

An explicit `project` or `endpoint` wins over the key's own. If neither gives
one, `mintAgentToken()` throws `AgentTokenError` naming it.

It returns `{ token, mcpUrl, expiresAt }`. Mint a new token before
`expiresAt`. An option Cloud would refuse throws `AgentTokenError`, whose
`field` names it.

The token is an EdDSA JWT whose `kid` names your key, with audience
`hypequery-agent:<project>`. Python's `hypequery.agent.mint_agent_token()`
mints the same token for the same input.

Runs on Node.js 20 or later and on runtimes with Web Crypto Ed25519 (Deno,
Bun, Cloudflare Workers, Vercel Edge).

Docs: https://hypequery.com/docs/cloud/in-app-agents

## Give your agent the tools

Add hypequery's analytics tools to an agent you already run. You get the
tools your tenant MCP endpoint serves (`list_datasets`, `get_dataset_schema`
and `query_dataset`) as tools for the Vercel AI SDK, the Anthropic SDK or the
OpenAI Agents SDK. You don't need an MCP client or to write any tools.


### AI SDK

```ts
import { streamText } from 'ai';
import { hypequeryTools } from '@hypequery/agent/ai-sdk';

const tools = await hypequeryTools({ url: mcpUrl, token });
const result = streamText({ model, tools, messages });
```

### Anthropic SDK

```ts
import Anthropic from '@anthropic-ai/sdk';
import { hypequeryTools } from '@hypequery/agent/anthropic';

const hq = await hypequeryTools({ url: mcpUrl, token });
const response = await anthropic.messages.create({ model, max_tokens: 1024, tools: hq.tools, messages });
messages.push({ role: 'assistant', content: response.content });
messages.push({ role: 'user', content: await hq.toolResults(response.content) });
```

`hq.runTool(name, input)` calls a single tool. `hq.toolResult(block)` answers a
single `tool_use` block.

### OpenAI Agents SDK

```ts
import { Agent, run } from '@openai/agents';
import { hypequeryTools } from '@hypequery/agent/openai-agents';

const agent = new Agent({ name: 'Analyst', tools: await hypequeryTools({ url: mcpUrl, token }) });
const result = await run(agent, 'How many shipments were late last month?');
```

### What you get

- **The server's schemas.** The tools are listed from the endpoint once per
  `hypequeryTools()` call. Each input schema is passed to your SDK exactly as
  the server sent it, with no re-typing.
- **The server's errors.** When a tool call fails (bad input, an unknown
  dataset, a timeout or a rate limit), the model gets
  `{ "error": { code, category, message, hint, docsUrl, requestId, ... } }`,
  the same error envelope MCP clients see, so it can fix the call and retry.
  If the endpoint refuses the token or can't be reached, the call throws
  `HypequeryToolsError` instead.
- **Request ids.** Use `onResult` to capture the request id of each call,
  which you can then look up in hypequery Cloud.
- **Short-lived tokens.** `token` can be a string or a function, sync or
  async, that returns the current token. The function is called before each
  request.

```ts
const tools = await hypequeryTools({
  url: mcpUrl,
  token: () => currentToken(),        // e.g. re-mint before the 15-minute expiry
  onResult: (result) => log(result.tool, result.requestId),
});
```

### Without an SDK

`createHypequeryToolsClient` (exported from `@hypequery/agent` and from every
subpath) returns a client with `listTools()`, `callTool(name, input)` and
`close()`, for any other agent loop. Every adapter also accepts a client in
place of its options, so you can close the MCP session yourself. If you don't
close it, the session closes after `idleTimeoutMs` with no calls (default 60
seconds).

### Peer dependencies

`ai`, `@anthropic-ai/sdk` and `@openai/agents` are optional peer
dependencies. Install only the SDK you use. The Anthropic adapter imports
nothing from its SDK at runtime.

### License

Apache-2.0
