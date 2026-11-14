import { generateText, streamText, type LanguageModel, type ModelMessage, type ToolSet } from 'ai';
import { createHypequeryToolsClient, hypequeryTools, type HypequeryAIToolSet } from '../src/tools/ai-sdk.js';

declare const model: LanguageModel;
declare const messages: ModelMessage[];
declare const mcpUrl: string;
declare const token: string;

// The README example: tools straight into streamText.
const tools = await hypequeryTools({ url: mcpUrl, token });
const toolSet: ToolSet = tools;
void toolSet;
void streamText({ model, tools, messages });
void generateText({ model, tools, prompt: 'Revenue by region?' });

// A token can be a function, sync or async, so a minted token can be refreshed.
void hypequeryTools({ url: new URL(mcpUrl), token: () => token });
void hypequeryTools({ url: mcpUrl, token: async () => token, headers: { 'x-hypequery-tenant-id': 't' } });

// Or a client you manage and close yourself.
const client = createHypequeryToolsClient({ url: mcpUrl, token });
const managed: Promise<HypequeryAIToolSet> = hypequeryTools(client);
void managed;
void client.close();

// @ts-expect-error token is required
void hypequeryTools({ url: mcpUrl });
// @ts-expect-error token must be a string or a function returning one
void hypequeryTools({ url: mcpUrl, token: 42 });

// In your own backend: an executor in this process, no endpoint or token.
import { createMCPExecutor } from '@hypequery/mcp';
declare const executorConfig: Parameters<typeof createMCPExecutor>[0];
const inProcess: Promise<HypequeryAIToolSet> = hypequeryTools({ executor: createMCPExecutor(executorConfig) });
void inProcess;
void hypequeryTools({ executor: createMCPExecutor(executorConfig), tools: ['list_datasets', 'query_dataset'] });
// @ts-expect-error tools is a list of names
void hypequeryTools({ executor: createMCPExecutor(executorConfig), tools: 'list_datasets' });
