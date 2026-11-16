import { Agent, run, type FunctionTool, type Tool } from '@openai/agents';
import { hypequeryTools } from '../src/tools/openai-agents.js';

declare const mcpUrl: string;
declare const token: string;

const tools = await hypequeryTools({ url: mcpUrl, token: async () => token });
const functionTools: FunctionTool<any, any, any>[] = tools;
const anyTools: Tool[] = tools;
void functionTools;
void anyTools;

const agent = new Agent({ name: 'Analyst', instructions: 'Answer from hypequery.', tools });
void run(agent, 'How many shipments were late last month?');
