import Anthropic from '@anthropic-ai/sdk';
import { hypequeryTools, type HypequeryToolResult } from '../src/tools/anthropic.js';

declare const anthropic: Anthropic;
declare const mcpUrl: string;
declare const token: string;

const hq = await hypequeryTools({ url: mcpUrl, token });

// Tool definitions are Anthropic tools, alone or with your own.
const tools: Anthropic.Tool[] = hq.tools;
void tools;
declare const ownTool: Anthropic.Tool;
const messages: Anthropic.MessageParam[] = [{ role: 'user', content: 'Revenue by region?' }];
const response = await anthropic.messages.create({
  model: 'claude-test',
  max_tokens: 1024,
  tools: [...hq.tools, ownTool],
  messages,
});

// tool_use blocks in, tool_result blocks out, ready for the next user turn.
const results: Anthropic.ToolResultBlockParam[] = await hq.toolResults(response.content);
messages.push({ role: 'assistant', content: response.content });
messages.push({ role: 'user', content: results });

for (const block of response.content) {
  if (block.type === 'tool_use') {
    const one: Anthropic.ToolResultBlockParam = await hq.toolResult(block);
    void one;
  }
}

// runTool returns the neutral result.
const result: HypequeryToolResult = await hq.runTool('query_dataset', { dataset: 'orders' });
if (result.ok) {
  const data: unknown = result.data;
  void data;
} else {
  const hint: string | undefined = result.error.hint;
  const requestId: string | undefined = result.error.requestId;
  void hint;
  void requestId;
}
await hq.close();
