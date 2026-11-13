# @hypequery/agent

Put a hypequery Cloud project's tenant-safe analytics in your own agent.

`mintAgentToken()` signs an end-user token in your backend with a project's
managed signing key. It makes no network call, so you can mint one per
session or per request. The tenant comes from the signed token, never from the
model, so a prompt can't reach another customer's data.

```bash
npm install @hypequery/agent
```

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

## Options

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

## License

Apache-2.0
