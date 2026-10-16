import path from 'node:path';
import type { MCPToolExecutor } from '@hypequery/mcp';
import { importFromProject } from './project-root.js';
import { runMcpUntilSignal } from './mcp-lifecycle.js';
import { MCP_API_KEY_VARIABLE } from './hosted-endpoints.js';
import { logger } from './logger.js';
import type { McpSession } from './telemetry/mcp-session.js';

interface HttpMcpDependencies {
  loadMcp?: () => Promise<unknown>;
  env?: Readonly<Record<string, string | undefined>>;
}
type HttpMcpPackage = Pick<typeof import('@hypequery/mcp'), 'createMCPHttpExecutor' | 'createMCPProtocolServer' | 'connectMCPServerStdio'>;

/** Load the user's optional peer without requiring or importing an analytics entrypoint. */
export async function loadHttpMcp(load?: () => Promise<unknown>): Promise<HttpMcpPackage> {
  let candidate: unknown;
  try {
    candidate = await (load ?? (() => importFromProject('@hypequery/mcp', path.join(process.cwd(), '__hypequery_mcp__.js'), () => import('@hypequery/mcp'))))();
  } catch { throw new Error('Install @hypequery/mcp with HTTP client-contract support in this project.'); }
  const module = candidate as Partial<HttpMcpPackage> | null;
  if (!module || typeof module.createMCPHttpExecutor !== 'function' || typeof module.createMCPProtocolServer !== 'function' || typeof module.connectMCPServerStdio !== 'function') {
    throw new Error('Upgrade @hypequery/mcp in this project to a version with createMCPHttpExecutor support.');
  }
  return module as HttpMcpPackage;
}

/** One backend principal per process. Python resolves authorization and tenant context. */
export async function runHttpMcp(url: string, selfTest: boolean, dependencies: HttpMcpDependencies, telemetry: McpSession): Promise<void> {
  const module = await loadHttpMcp(dependencies.loadMcp);
  const key = (dependencies.env ?? process.env)[MCP_API_KEY_VARIABLE]?.trim();
  const create = async (signal?: AbortSignal): Promise<MCPToolExecutor> => {
    try {
      return await module.createMCPHttpExecutor({ url, ...(key ? { headers: { authorization: `Bearer ${key}` } } : {}) }, signal);
    } catch {
      if (signal?.aborted) throw signal.reason;
      // Do not echo a URL, credential, backend response or user-installed peer's error.
      throw new Error('Could not initialize the HTTP MCP bridge. Check the discovery URL, backend access and client-contract compatibility.');
    }
  };
  if (selfTest) {
    const executor = await create();
    let tools: Awaited<ReturnType<MCPToolExecutor['listTools']>>;
    try { tools = await executor.listTools(); }
    catch { throw new Error('HTTP MCP discovery check failed. Check backend access and reconnect after contract changes.'); }
    logger.success('Authorized HTTP client contract is ready for MCP.');
    logger.info(`Tools: ${tools.tools.length}`);
    logger.info('No query tool was called. Python resolves the principal and tenant.');
    return;
  }
  await runMcpUntilSignal(async signal => {
    const executor = await create(signal);
    signal.throwIfAborted();
    const server = module.createMCPProtocolServer({ executor: telemetry.instrument(executor) });
    try { await module.connectMCPServerStdio(server); }
    catch { await server.close().catch(() => undefined); throw new Error('Could not connect the MCP stdio transport.'); }
    telemetry.start({ mode: 'serve', tenant_used: false, http_backend: true });
    process.stderr.write('hypequery MCP serving an authorized HTTP client contract.\n');
    return server;
  });
}
