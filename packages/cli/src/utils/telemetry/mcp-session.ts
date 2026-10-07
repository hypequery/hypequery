import type { MCPToolExecutor } from '@hypequery/mcp';
import { countBucket } from './buckets.js';
import { startCommandSession, type SessionStart, type SessionEnd } from './command-context.js';

const toolKinds: Readonly<Record<string, 'list' | 'describe' | 'query'>> = {
  list_datasets: 'list', get_dataset_schema: 'describe', query_dataset: 'query', query_metric: 'query',
};

export class McpSession {
  private calls = { list: 0, describe: 0, query: 0 };
  private errors = 0;

  start(properties: SessionStart<'mcp'>): void {
    startCommandSession('mcp', properties, () => this.snapshot());
  }

  instrument(executor: MCPToolExecutor): MCPToolExecutor {
    return {
      listTools: () => executor.listTools(), listPrompts: () => executor.listPrompts(),
      getPrompt: (name, args) => executor.getPrompt(name, args), getManifestHash: () => executor.getManifestHash(),
      callTool: async (name, args, signal) => {
        if (Object.hasOwn(toolKinds, name)) this.calls[toolKinds[name]]++;
        try {
          const result = await executor.callTool(name, args, signal);
          if (result.isError) this.errors++;
          return result;
        } catch (error) { this.errors++; throw error; }
      },
    };
  }

  snapshot(): SessionEnd<'mcp'> {
    return { tool_call_counts: { list: countBucket(this.calls.list)!, describe: countBucket(this.calls.describe)!, query: countBucket(this.calls.query)! },
      error_count_bucket: countBucket(this.errors)! };
  }
}
