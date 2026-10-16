import { createMCPHttpExecutor, createMCPProtocolServer, type MCPHttpExecutorConfig, type MCPToolExecutor } from '@hypequery/mcp';
const config: MCPHttpExecutorConfig = { url: 'https://python.example.test/client-contract', headers: async () => ({ authorization: 'Bearer fixture' }) };
const executor: MCPToolExecutor = await createMCPHttpExecutor(config);
createMCPProtocolServer({ executor });
