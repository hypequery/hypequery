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
