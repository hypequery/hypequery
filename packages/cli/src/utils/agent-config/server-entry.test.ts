import { describe, expect, it } from 'vitest';
import { entryExecutables, isManagedEntry, localServerCommand } from './server-entry.js';

describe('local MCP server command', () => {
  const base = { projectDirectory: '/project', nodePath: '/n/bin/node', version: '1.32.0' };

  it("prefers the project's own CLI, by its stable node_modules path", () => {
    expect(localServerCommand({
      ...base,
      resolveFromProject: () => '/project/node_modules/@hypequery/cli/dist/bin/cli.js',
      exists: () => true,
    })).toEqual({ command: '/n/bin/node', args: ['/project/node_modules/@hypequery/cli/dist/bin/cli.js', 'mcp'] });
  });

  it('uses a global CLI by its real path', () => {
    expect(localServerCommand({
      ...base, resolveFromProject: () => undefined, cliPath: '/usr/local/bin/hypequery', exists: () => true,
      realpath: () => '/usr/local/lib/node_modules/@hypequery/cli/dist/bin/cli.js',
    }).args[0]).toBe('/usr/local/lib/node_modules/@hypequery/cli/dist/bin/cli.js');
  });

  it('never points at a throwaway npx copy: pins the version through npx instead', () => {
    expect(localServerCommand({
      ...base, resolveFromProject: () => undefined, cliPath: '/x', exists: file => file === '/x',
      realpath: () => '/home/me/.npm/_npx/abc/node_modules/@hypequery/cli/dist/bin/cli.js',
    })).toEqual({ command: 'npx', args: ['-y', '@hypequery/cli@1.32.0', 'mcp'] });
  });
});

describe('MCP entries', () => {
  it('recognises only entries hypequery wrote', () => {
    expect(isManagedEntry({ command: 'node', env: { HYPEQUERY_MCP_CONFIGURED_BY: 'hypequery' } })).toBe(true);
    expect(isManagedEntry({ url: 'https://mcp.hypequery.com/mcp' })).toBe(true);
    expect(isManagedEntry({ command: 'node' })).toBe(false);
  });

  it('lists the absolute files an entry launches', () => {
    expect(entryExecutables({ command: '/n/node', args: ['/cli.js', 'mcp'] })).toEqual(['/n/node', '/cli.js']);
    expect(entryExecutables({ command: 'npx', args: ['-y', 'x'] })).toEqual([]);
  });
});

describe('Windows shims', () => {
  it('quotes each argument for cmd.exe and refuses what cmd.exe would expand', async () => {
    const { windowsShimCommandLine } = await import('./run-command.js');
    expect(windowsShimCommandLine('C:\\npm\\codex.cmd', ['mcp', 'add', 'hypequery', '--', 'C:\\Program Files\\node.exe', 'a&b']))
      .toBe('""C:\\npm\\codex.cmd" "mcp" "add" "hypequery" "--" "C:\\Program Files\\node.exe" "a&b""');
    expect(() => windowsShimCommandLine('codex.cmd', ['%PATH%'])).toThrow('cmd.exe');
    expect(() => windowsShimCommandLine('codex.cmd', ['a"b'])).toThrow('cmd.exe');
  });

  it('reads a Codex entry from `mcp get --json`', async () => {
    const { codexEntry } = await import('./codex.js');
    expect(codexEntry(JSON.stringify({ transport: { type: 'stdio', command: '/n/node', args: ['/cli.js', 'mcp'], env: { A: '1' } } })))
      .toEqual({ command: '/n/node', args: ['/cli.js', 'mcp'], env: { A: '1' } });
    expect(codexEntry(JSON.stringify({ transport: { type: 'streamable_http', url: 'https://mcp.hypequery.com/mcp' } })))
      .toEqual({ url: 'https://mcp.hypequery.com/mcp' });
    expect(codexEntry('hypequery\n  command: node')).toBeUndefined();
  });
});

describe('code without comments', () => {
  it('drops comments and string contents, so only a real tenantKey setting matches', async () => {
    const { codeWithoutComments } = await import('./code-without-comments.js');
    const tenant = (source: string) => /\btenant(Key|_key)\s*[:=]/.test(codeWithoutComments(source));
    expect(tenant("dataset('orders', {\n  // tenantKey: 'account_id',   // only if the user named this column\n  source: 'orders',\n})")).toBe(false);
    expect(tenant("/* tenantKey: 'x' */ const a = 1;")).toBe(false);
    expect(tenant("const url = 'https://x//tenantKey: y'; const b = `tenantKey: ${1}`;")).toBe(false);
    expect(tenant("dataset('orders', { tenantKey: 'account_id' })")).toBe(true);
    expect(tenant("const s = '//'; export const d = { tenantKey: 't' };")).toBe(true);
  });
});
