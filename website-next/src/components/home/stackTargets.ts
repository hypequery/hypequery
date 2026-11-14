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
    label: 'In your app (TypeScript)',
    targets: [
      { id: 'ai-sdk', name: 'Vercel AI SDK', detail: 'Tools for streamText and generateText', href: '/docs/agents/quickstart' },
      { id: 'anthropic-sdk', name: 'Anthropic SDK', detail: 'Tool definitions and tool_result helpers', href: '/docs/agents/tools#anthropic-sdk' },
      { id: 'openai-agents', name: 'OpenAI Agents SDK', detail: 'Function tools for new Agent({ tools })', href: '/docs/agents/tools#openai-agents-sdk' },
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
    label: 'Your ClickHouse',
    targets: [
      { id: 'clickhouse-cloud', name: 'ClickHouse Cloud', detail: 'Connect over HTTPS', href: '/docs/reference/connection' },
      { id: 'self-hosted', name: 'Self-hosted', detail: 'Your own servers or cluster', href: '/docs/reference/connection' },
      { id: 'chdb', name: 'chDB', detail: 'ClickHouse embedded in your process, no server', href: '/docs/chdb' },
    ],
  },
  {
    label: 'Hosted by',
    targets: [
      { id: 'your-servers', name: 'Your servers', detail: 'A library inside your app', href: '/docs/quick-start/api-and-dashboard' },
      { id: 'hypequery-cloud', name: 'hypequery Cloud', detail: 'Hosted APIs and MCP, with releases and logs', href: '/docs/cloud' },
    ],
  },
];
