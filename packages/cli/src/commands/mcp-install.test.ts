import { mkdir, mkdtemp, readFile, realpath, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mcpInstallCommand, type CommandRun } from './mcp-install.js';

vi.mock('../utils/logger.js', () => ({ logger: { success: vi.fn(), error: vi.fn(), warn: vi.fn(), info: vi.fn() } }));

const temporary: string[] = [];
async function directory(): Promise<string> {
  const created = await realpath(await mkdtemp(path.join(tmpdir(), 'hq-mcp-install-')));
  temporary.push(created);
  return created;
}
afterEach(async () => {
  process.exitCode = 0;
  await Promise.all(temporary.splice(0).map(item => rm(item, { recursive: true, force: true })));
});

const serverCommand = { command: '/opt/node/bin/node', args: ['/project/node_modules/@hypequery/cli/dist/bin/cli.js', 'mcp'] };

async function setup() {
  const home = await directory();
  const cwd = await directory();
  return { home, cwd, serverCommand, platform: 'linux' as const, env: { PATH: '' }, hasEntrypoint: async () => true };
}

const readJson = async (file: string) => JSON.parse(await readFile(file, 'utf8'));

describe('hypequery mcp:install', () => {
  it('adds a local stdio server to Claude Code for this project only, with absolute Node and no credentials', async () => {
    const dependencies = await setup();
    await writeFile(path.join(dependencies.home, '.claude.json'), JSON.stringify({ numStartups: 3, projects: { '/other': { allowedTools: [] } } }));
    const changes = await mcpInstallCommand({ agent: 'claude-code' }, dependencies);
    expect(changes).toMatchObject([{ client: 'claude-code', scope: 'project', outcome: 'added' }]);
    const config = await readJson(path.join(dependencies.home, '.claude.json'));
    expect(config.numStartups).toBe(3);
    expect(config.projects['/other']).toEqual({ allowedTools: [] });
    expect(config.projects[dependencies.cwd].mcpServers.hypequery).toEqual({
      type: 'stdio',
      command: '/opt/node/bin/node',
      args: ['/project/node_modules/@hypequery/cli/dist/bin/cli.js', 'mcp'],
      env: { HYPEQUERY_PROJECT_DIR: dependencies.cwd, HYPEQUERY_MCP_CONFIGURED_BY: 'hypequery' },
    });
    expect(JSON.stringify(config)).not.toMatch(/PASSWORD/);
    // The previous file is kept beside it.
    expect(await readJson(path.join(dependencies.home, '.claude.json.hypequery-backup'))).toMatchObject({ numStartups: 3 });
  });

  it('is idempotent and reports unchanged on the second run', async () => {
    const dependencies = await setup();
    await mcpInstallCommand({ agent: 'claude-code', scope: 'user' }, dependencies);
    const changes = await mcpInstallCommand({ agent: 'claude-code', scope: 'user' }, dependencies);
    expect(changes[0].outcome).toBe('unchanged');
    expect((await readJson(path.join(dependencies.home, '.claude.json'))).mcpServers.hypequery.command).toBe('/opt/node/bin/node');
  });

  it('refuses to replace a server it did not write, unless forced', async () => {
    const dependencies = await setup();
    const file = path.join(dependencies.home, '.cursor', 'mcp.json');
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, JSON.stringify({ mcpServers: { hypequery: { command: 'mine' } } }));
    const changes = await mcpInstallCommand({ agent: 'cursor', scope: 'user' }, dependencies);
    expect(changes[0]).toMatchObject({ outcome: 'failed', reason: expect.stringContaining('--force') });
    expect(process.exitCode).toBe(1);
    expect((await readJson(file)).mcpServers.hypequery).toEqual({ command: 'mine' });
    process.exitCode = 0;
    await mcpInstallCommand({ agent: 'cursor', scope: 'user', force: true }, dependencies);
    expect((await readJson(file)).mcpServers.hypequery.env.HYPEQUERY_MCP_CONFIGURED_BY).toBe('hypequery');
  });

  it('leaves a config with comments or invalid JSON untouched', async () => {
    const dependencies = await setup();
    const file = path.join(dependencies.cwd, '.cursor', 'mcp.json');
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, '{ // mine\n "mcpServers": {} }');
    const changes = await mcpInstallCommand({ agent: 'cursor' }, dependencies);
    expect(changes[0]).toMatchObject({ outcome: 'failed', reason: expect.stringContaining('not plain JSON') });
    expect(await readFile(file, 'utf8')).toBe('{ // mine\n "mcpServers": {} }');
  });

  it('--dry-run writes nothing', async () => {
    const dependencies = await setup();
    const changes = await mcpInstallCommand({ agent: 'claude-code', dryRun: true }, dependencies);
    expect(changes[0].outcome).toBe('added');
    await expect(stat(path.join(dependencies.home, '.claude.json'))).rejects.toThrow();
  });

  it('--hosted adds the connector by URL and skips Claude Desktop, which takes it from Settings', async () => {
    const dependencies = { ...(await setup()), platform: 'darwin' as const };
    const changes = await mcpInstallCommand({ agent: 'claude-code,claude-desktop', hosted: true }, dependencies);
    expect(changes.map(change => [change.client, change.outcome])).toEqual([['claude-code', 'added'], ['claude-desktop', 'skipped']]);
    expect((await readJson(path.join(dependencies.home, '.claude.json'))).mcpServers['hypequery-cloud'])
      .toEqual({ type: 'http', url: 'https://mcp.hypequery.com/mcp' });
  });

  it('--remove takes out only its own entry', async () => {
    const dependencies = await setup();
    await mcpInstallCommand({ agent: 'claude-code', scope: 'user' }, dependencies);
    const changes = await mcpInstallCommand({ agent: 'claude-code', scope: 'user', remove: true }, dependencies);
    expect(changes[0].outcome).toBe('removed');
    expect((await readJson(path.join(dependencies.home, '.claude.json'))).mcpServers).toEqual({});
  });

  it('configures Codex through `codex mcp add`, never by editing its TOML', async () => {
    const dependencies = await setup();
    const bin = await directory();
    await writeFile(path.join(bin, 'codex'), '');
    const calls: string[][] = [];
    const run = (command: string, args: readonly string[]): CommandRun => {
      calls.push([command, ...args]);
      return args[1] === 'get' ? { status: 1, stdout: '', stderr: 'not found' } : { status: 0, stdout: '', stderr: '' };
    };
    const changes = await mcpInstallCommand({ agent: 'codex' }, { ...dependencies, env: { PATH: bin }, run });
    expect(changes[0]).toMatchObject({ client: 'codex', scope: 'user', outcome: 'added' });
    expect(calls[1]).toEqual([
      path.join(bin, 'codex'), 'mcp', 'add', 'hypequery',
      '--env', `HYPEQUERY_PROJECT_DIR=${dependencies.cwd}`,
      '--env', 'HYPEQUERY_MCP_CONFIGURED_BY=hypequery',
      '--', '/opt/node/bin/node', '/project/node_modules/@hypequery/cli/dist/bin/cli.js', 'mcp',
    ]);
  });

  it('names the flag to pass when no agent is installed', async () => {
    const dependencies = await setup();
    await expect(mcpInstallCommand({}, { ...dependencies, exists: () => false })).rejects.toMatchObject({ code: 'NO_AGENT_FOUND' });
  });
});
