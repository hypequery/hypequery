import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadHttpMcp, runHttpMcp } from './mcp-http.js';
import { McpSession } from './telemetry/mcp-session.js';

vi.mock('./logger.js', () => ({ logger: { success: vi.fn(), info: vi.fn() } }));
const url = 'https://backend.example.test/mounted/v1/client-contract';
function peer() {
  const executor = { listTools: vi.fn(async () => ({ tools: [] })), callTool: vi.fn(), listPrompts: vi.fn(), getPrompt: vi.fn(), getManifestHash: () => 'hash' };
  const server = { close: vi.fn(async () => undefined) };
  return { executor, server, module: { createMCPHttpExecutor: vi.fn(async () => executor), createMCPProtocolServer: vi.fn(() => server), connectMCPServerStdio: vi.fn(async () => undefined) } };
}
afterEach(() => vi.restoreAllMocks());
describe('HTTP MCP CLI mode', () => {
  it('checks discovery without opening stdio or executing a query', async () => {
    const { module, executor } = peer();
    await runHttpMcp(url, true, { loadMcp: async () => module, env: { HYPEQUERY_API_KEY: '  secret  ' } }, new McpSession());
    expect(module.createMCPHttpExecutor).toHaveBeenCalledWith({ url, headers: { authorization: 'Bearer secret' } }, undefined);
    expect(executor.listTools).toHaveBeenCalledOnce();
    expect(executor.callTool).not.toHaveBeenCalled();
    expect(module.connectMCPServerStdio).not.toHaveBeenCalled();
  });
  it('permits a backend authorizing public access without a Bearer key', async () => {
    const { module } = peer();
    await runHttpMcp(url, true, { loadMcp: async () => module, env: {} }, new McpSession());
    expect(module.createMCPHttpExecutor).toHaveBeenCalledWith({ url }, undefined);
  });
  it.each([{}, { createMCPExecutor: () => ({}) }])('reports an old optional peer clearly', async module => {
    await expect(loadHttpMcp(async () => module)).rejects.toThrow('Upgrade @hypequery/mcp');
  });
  it('redacts errors importing the optional peer', async () => {
    await expect(loadHttpMcp(async () => { throw new Error('PRIVATE_PATH'); })).rejects.toThrow('Install @hypequery/mcp');
  });
  it.each(['create', 'list'] as const)('redacts %s errors and backend response details', async phase => {
    const { module, executor } = peer();
    if (phase === 'create') module.createMCPHttpExecutor.mockRejectedValue(new Error('PRIVATE_URL_AND_TOKEN'));
    else executor.listTools.mockRejectedValue(new Error('PRIVATE_RESPONSE'));
    const error = await runHttpMcp(url, true, { loadMcp: async () => module, env: {} }, new McpSession()).catch(error => error);
    expect(error).toBeInstanceOf(Error);
    expect(error.message).not.toContain('PRIVATE');
  });
  it('serves an instrumented executor and closes on signal with no stdout status', async () => {
    const { module, server } = peer();
    const stdout = vi.spyOn(process.stdout, 'write');
    const stderr = vi.spyOn(process.stderr, 'write').mockReturnValue(true);
    const telemetry = new McpSession();
    const start = vi.spyOn(telemetry, 'start').mockImplementation(() => undefined);
    const command = runHttpMcp(url, false, { loadMcp: async () => module, env: {} }, telemetry);
    await vi.waitFor(() => expect(start).toHaveBeenCalled());
    process.emit('SIGTERM');
    await command;
    expect(server.close).toHaveBeenCalledOnce();
    expect(stdout).not.toHaveBeenCalled();
    expect(stderr).toHaveBeenCalledWith(expect.stringContaining('authorized HTTP'));
    expect(start).toHaveBeenCalledWith({ mode: 'serve', tenant_used: false, http_backend: true });
    expect(module.createMCPProtocolServer).toHaveBeenCalledWith({ executor: expect.objectContaining({ callTool: expect.any(Function) }) });
  });
  it('aborts discovery during startup and exits cleanly on signal', async () => {
    const { module } = peer();
    module.createMCPHttpExecutor.mockImplementation((...args: unknown[]) => new Promise((_, reject) => {
      const signal = args[1] as AbortSignal;
      signal.addEventListener('abort', () => reject(signal.reason), { once: true });
    }));
    const command = runHttpMcp(url, false, { loadMcp: async () => module, env: {} }, new McpSession());
    await vi.waitFor(() => expect(module.createMCPHttpExecutor).toHaveBeenCalled());
    process.emit('SIGINT');
    await command;
    expect(module.connectMCPServerStdio).not.toHaveBeenCalled();
  });
  it('closes the protocol server when connection fails and redacts its error', async () => {
    const { module, server } = peer();
    module.connectMCPServerStdio.mockRejectedValue(new Error('PRIVATE'));
    await expect(runHttpMcp(url, false, { loadMcp: async () => module, env: {} }, new McpSession())).rejects.toThrow('Could not connect the MCP stdio transport.');
    expect(server.close).toHaveBeenCalledOnce();
  });
});
