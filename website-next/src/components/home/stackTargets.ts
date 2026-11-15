// The agent and database columns of the "Runs where your app runs" section, each linking to its docs.

export type StackTarget = {
  id: string;
  name: string;
  /** Shown as the chip's tooltip. */
  detail: string;
  href: string;
};

export type StackGroup = { label: string; targets: StackTarget[] };

export const AGENT_GROUPS: StackGroup[] = [
  {
    label: 'In your app',
    targets: [
      { id: 'ai-sdk', name: 'Vercel AI SDK', detail: 'TypeScript: tools for streamText and generateText', href: '/docs/agents/quickstart' },
      { id: 'pydantic-ai', name: 'Pydantic AI', detail: 'Python: tools for Agent(tools=...)', href: '/clickhouse-pydantic' },
      { id: 'anthropic-sdk', name: 'Anthropic SDK', detail: 'TypeScript and Python: tool definitions and tool_result helpers', href: '/docs/agents/tools#anthropic-sdk' },
      { id: 'openai-agents', name: 'OpenAI Agents SDK', detail: 'TypeScript and Python: function tools for an Agent', href: '/docs/agents/tools#openai-agents-sdk' },
    ],
  },
  {
    label: 'Over MCP',
    targets: [
      { id: 'claude', name: 'Claude', detail: 'Claude Code and Claude Desktop', href: '/blog/clickhouse-mcp-claude-code' },
      { id: 'cursor', name: 'Cursor', detail: 'One project or every project', href: '/blog/clickhouse-mcp-cursor' },
      { id: 'codex', name: 'Codex', detail: 'codex mcp add', href: '/blog/clickhouse-mcp-codex' },
      { id: 'mcp-clients', name: 'Any MCP client', detail: 'Over stdio or HTTP', href: '/docs/mcp/clients' },
    ],
  },
];

export const DATABASE_GROUPS: StackGroup[] = [
  {
    label: 'Where your data lives',
    targets: [
      { id: 'clickhouse-cloud', name: 'ClickHouse Cloud', detail: 'Connect over HTTPS', href: '/docs/reference/connection' },
      { id: 'self-hosted', name: 'Self-hosted', detail: 'Your own servers or cluster', href: '/docs/reference/connection' },
      { id: 'chdb', name: 'chDB', detail: 'ClickHouse embedded in your process, no server', href: '/docs/chdb' },
    ],
  },
];

/** The other way to run the backend column: hypequery serves it, against your ClickHouse. */
export const HOSTED_GROUP: StackGroup = {
  label: 'Or hosted for you',
  targets: [
    {
      id: 'hypequery-cloud',
      name: 'hypequery Cloud',
      detail: 'Coming soon: the same APIs and MCP, hosted, querying your ClickHouse with a read-only user',
      href: '/docs/cloud',
    },
  ],
};
