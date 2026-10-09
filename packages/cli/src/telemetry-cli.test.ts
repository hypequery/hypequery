import { execFile, spawn } from 'node:child_process';
import { mkdtemp, mkdir, rm, writeFile, readdir, utimes } from 'node:fs/promises';
import { createServer as createTcpServer } from 'node:net';
import { createHash, randomUUID } from 'node:crypto';
import { hostname, tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { program } from './cli.js';

const execute = promisify(execFile);
const bin = path.resolve('dist/bin/cli.js');

describe('compiled CLI telemetry regression', () => {
  let directory: string;
  beforeAll(async () => { directory = await mkdtemp(path.join(tmpdir(), 'hq-cli-regression-')); });
  afterAll(async () => { await rm(directory, { recursive: true, force: true }); });

  async function run(args: string[], mode: 'off' | 'debug' | 'failing' | 'stalled', cwd = directory, extraEnv: NodeJS.ProcessEnv = {}) {
    const env = { ...process.env, ...extraEnv, HYPEQUERY_CONFIG_DIR: directory };
    for (const key of ['VITEST', 'NODE_ENV', 'DO_NOT_TRACK', 'HYPEQUERY_TELEMETRY_DISABLED', 'HYPEQUERY_TELEMETRY_URL', 'HYPEQUERY_TELEMETRY_DEBUG', 'GITHUB_ACTIONS']) delete env[key];
    if (mode === 'debug') env.HYPEQUERY_TELEMETRY_DEBUG = '1';
    else if (mode === 'failing') env.HYPEQUERY_TELEMETRY_URL = 'http://127.0.0.1:1/batch';
    else if (mode === 'stalled') env.HYPEQUERY_TELEMETRY_URL = extraEnv.HYPEQUERY_TELEMETRY_URL;
    else env.HYPEQUERY_TELEMETRY_DISABLED = '1';
    let result: { stdout: string; stderr: string; code?: number };
    try { result = await execute(process.execPath, [bin, ...args], { cwd, env, timeout: 10_000 }); }
    catch (error) { result = error as typeof result; }
    const events: Array<{ event: string; properties: Record<string, unknown> }> = [];
    const stderr = result.stderr.split('\n').filter(line => {
      try { const parsed = JSON.parse(line); if (parsed.event) { events.push(parsed); return false; } } catch { /* Normal command output. */ }
      return true;
    }).join('\n');
    return { code: result.code ?? 0, stdout: result.stdout, stderr, events };
  }

  it('recovers a lock left by a killed process but never takes a live owner\'s lock', async () => {
    const settings = await mkdtemp(path.join(tmpdir(), 'hq-cli-settings-lock-'));
    try {
      const env = { ...process.env, HYPEQUERY_CONFIG_DIR: settings };
      for (const key of ['VITEST', 'NODE_ENV', 'DO_NOT_TRACK', 'HYPEQUERY_TELEMETRY_DISABLED']) delete env[key];
      await execute(process.execPath, [bin, 'telemetry', 'status'], { cwd: settings, env });
      const lock = path.join(settings, 'telemetry.lock');
      const host = createHash('sha256').update(hostname()).digest('hex').slice(0, 12);
      const plantLock = async (pid: number) => {
        await mkdir(lock);
        await writeFile(path.join(lock, `owner.${pid}.${host}.${randomUUID()}`), '');
      };

      // A live owner (this test process), however old its lock, keeps it.
      await plantLock(process.pid);
      const ancient = new Date(Date.now() - 60 * 60 * 1000);
      await utimes(lock, ancient, ancient);
      const refused = await execute(process.execPath, [bin, 'telemetry', 'disable'], { cwd: settings, env })
        .catch((error: { code?: number; stderr: string }) => error);
      expect(refused).toMatchObject({ code: 1 });
      expect(await readdir(lock)).toHaveLength(1);
      await rm(lock, { recursive: true });

      // What SIGKILL or a crash mid-write leaves: a lock whose owner process has exited.
      const exited = spawn(process.execPath, ['-e', '']);
      await new Promise(resolve => exited.on('exit', resolve));
      await plantLock(exited.pid!);
      const disabled = await execute(process.execPath, [bin, 'telemetry', 'disable'], { cwd: settings, env });
      expect(disabled.stdout).toContain('disabled');
      const status = await execute(process.execPath, [bin, 'telemetry', 'status'], { cwd: settings, env });
      expect(status.stdout).toContain('Telemetry: disabled');
      expect(await readdir(settings)).toEqual(['telemetry.json']);
    } finally {
      await rm(settings, { recursive: true, force: true });
    }
  }, 30_000);

  it('exits promptly when the ingest endpoint never completes its connection', async () => {
    // Accepts TCP but never answers the TLS handshake. Built-in fetch kept the
    // process alive here for its ~10 s connect timeout even after aborting.
    const sockets = new Set<import('node:net').Socket>();
    const server = createTcpServer(socket => { sockets.add(socket); /* Never speak TLS. */ });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address() as { port: number };
    try {
      const off = await run(['init', '--help'], 'off');
      const started = performance.now();
      const stalled = await run(['init', '--help'], 'stalled', directory, { HYPEQUERY_TELEMETRY_URL: `https://127.0.0.1:${port}/batch` });
      const elapsed = performance.now() - started;
      expect({ code: stalled.code, stdout: stalled.stdout, stderr: stalled.stderr }).toEqual({ code: off.code, stdout: off.stdout, stderr: off.stderr });
      expect(elapsed).toBeLessThan(2_000);
    } finally {
      // The server never reads, so it must drop accepted sockets itself.
      for (const socket of sockets) socket.destroy();
      await new Promise<void>(resolve => server.close(() => resolve()));
    }
  }, 30_000);

  it('preserves exit code and output for every command help page with telemetry on/off', async () => {
    for (const command of program.commands) {
      const args = [command.name(), '--help'];
      const off = await run(args, 'off');
      const on = await run(args, 'debug');
      const failing = await run(args, 'failing');
      expect({ code: on.code, stdout: on.stdout, stderr: on.stderr }, command.name()).toEqual({ code: off.code, stdout: off.stdout, stderr: off.stderr });
      expect({ code: failing.code, stdout: failing.stdout, stderr: failing.stderr }, command.name()).toEqual({ code: off.code, stdout: off.stdout, stderr: off.stderr });
      expect(on.events).toHaveLength(1);
      if (on.events.length) expect(on.events[0].properties).toMatchObject({ command: 'help', help_topic: command.name() });
    }
  }, 60_000);

  it.each([
    ['--version'], ['PRIVATE_UNKNOWN_COMMAND'], ['init', '--PRIVATE_UNKNOWN_OPTION'],
    ['generate:manifest'], ['dev', '--no-watch'], ['mcp', '--self-test'],
    ['generate:datasets', '--check', '--force'],
    ['init', '--no-interactive', '--database', 'PRIVATE_DB'], ['generate', '--database', 'PRIVATE_DB'],
    ['generate:types', '--database', 'PRIVATE_DB'], ['login', '--cloud-url', 'http://PRIVATE_HOST'],
    ['deployment:build', 'PRIVATE_SOURCE'], ['deployment:validate', 'PRIVATE_ARTIFACT'],
    ['deployment:release', 'PRIVATE_BUNDLE'], ['deployment:submit', 'PRIVATE_BUNDLE', '--release', 'PRIVATE_RELEASE'],
    ['deployment:status'], ['deploy', 'PRIVATE_SOURCE'], ['pull'], ['diff'], ['logout'],
  ])('preserves failure/version behavior and emits once: %j', async (...args) => {
    const off = await run(args, 'off');
    const on = await run(args, 'debug');
    const failing = await run(args, 'failing');
    expect({ code: on.code, stdout: on.stdout, stderr: on.stderr }).toEqual({ code: off.code, stdout: off.stdout, stderr: off.stderr });
    expect({ code: failing.code, stdout: failing.stdout, stderr: failing.stderr }).toEqual({ code: off.code, stdout: off.stdout, stderr: off.stderr });
    expect(on.events).toHaveLength(1);
    expect(JSON.stringify(on.events)).not.toContain('PRIVATE');
  }, 10_000);

  it('never emits on telemetry disable or with the global opt-out, even in debug mode', async () => {
    expect((await run(['telemetry', 'disable'], 'debug')).events).toHaveLength(0);
    await run(['telemetry', 'enable'], 'off');
    expect((await run(['--version', '--no-telemetry'], 'debug')).events).toHaveLength(0);
  });

  it('preserves successful init output with debug or failed delivery and emits only bucketed onboarding metrics', async () => {
    const results = [];
    for (const mode of ['off', 'debug', 'failing'] as const) {
      const cwd = path.join(directory, `PRIVATE_PROJECT_${mode}`);
      await mkdir(cwd);
      await writeFile(path.join(cwd, 'package.json'), JSON.stringify({ name: 'PRIVATE_PROJECT' }));
      results.push(await run(['init', '--no-interactive', '--skip-connection', '--style', 'datasets',
        '--auth', 'context', '--no-example', '--tables', 'PRIVATE_TABLE', '--path', 'PRIVATE_ANALYTICS'], mode, cwd, {
        HYPEQUERY_SKIP_INSTALL: '1', CLICKHOUSE_URL: 'http://PRIVATE_HOST',
        CLICKHOUSE_DATABASE: 'PRIVATE_DATABASE', CLICKHOUSE_USERNAME: 'PRIVATE_USER', CLICKHOUSE_PASSWORD: 'PRIVATE_PASSWORD',
      }));
    }
    const [off, debug, failing] = results;
    expect(off.code).toBe(0);
    expect({ ...debug, events: [] }).toEqual(off);
    expect(failing).toEqual(off);
    expect(debug.events).toHaveLength(1);
    expect(debug.events[0].properties).toMatchObject({ command: 'init', outcome: 'success', stage_reached: 'completed',
      connection_result: 'skipped', style: 'datasets', auth: 'context', interactive: false, example: false,
      table_selection: 'list', datasets_generated_bucket: '0', env_file: 'created', gitignore: 'created' });
    expect(JSON.stringify(debug.events)).not.toContain('PRIVATE');
  });

  it('waits for real dev teardown and reports interruption on SIGINT', async () => {
    const file = path.join(directory, 'signal-api.mjs');
    await writeFile(file, 'export const api = { queries: {}, queryLogger: { on() {} }, handler: () => new Response("ok") };');
    const env = { ...process.env, HYPEQUERY_CONFIG_DIR: directory, HYPEQUERY_TELEMETRY_DEBUG: '1', CLICKHOUSE_URL: 'http://127.0.0.1:1' };
    for (const key of ['VITEST', 'NODE_ENV', 'DO_NOT_TRACK', 'HYPEQUERY_TELEMETRY_DISABLED', 'HYPEQUERY_TELEMETRY_URL', 'GITHUB_ACTIONS']) delete env[key];
    const child = spawn(process.execPath, [bin, 'dev', file, '--no-watch', '--port', '0'], { cwd: directory, env, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => child.kill('SIGKILL'), 8_000);
    child.stdout.on('data', chunk => {
      stdout += chunk.toString();
      if (stdout.includes('Query execution stats will appear')) child.kill('SIGINT');
    });
    child.stderr.on('data', chunk => { stderr += chunk.toString(); });
    try {
      const exit = await new Promise<number | null>((resolve, reject) => { child.once('error', reject); child.once('close', resolve); });
      expect(exit).toBe(0);
      expect(stdout).toContain('Shutting down dev server');
      const events = stderr.split('\n').flatMap(line => { try { const event = JSON.parse(line); return event.event ? [event] : []; } catch { return []; } });
      expect(events.map(event => event.event)).toEqual(['cli_session_started', 'cli_session_ended', 'cli_command_completed']);
      expect(events[0].properties).toMatchObject({ command: 'dev', entry_type: 'explicit_file', watch: false, custom_port: true });
      expect(events[1].properties).toMatchObject({ command: 'dev', outcome: 'interrupted', reload_count_bucket: '0', reload_error_count_bucket: '0', load_failures: {} });
      expect(events[2].properties).toMatchObject({ command: 'dev', outcome: 'interrupted' });
    } finally { clearTimeout(timer); child.kill('SIGKILL'); }
  }, 10_000);

  it('keeps MCP stdio unchanged while aggregating tool kinds at shutdown', async () => {
    const file = path.join(directory, 'PRIVATE_MCP_API.mjs');
    await writeFile(file, `
const datasets = { PRIVATE_DATASET: { description: 'PRIVATE_DESCRIPTION', dimensions: { PRIVATE_DIMENSION: { type: 'string' } }, measures: { PRIVATE_MEASURE: { type: 'number' } }, metrics: {} } };
const analytics = { execute: async () => ({ data: [{ PRIVATE_MEASURE: 3 }], meta: { rowCount: 1, executionTimeMs: 0 } }) };
export const api = { handler: () => new Response('ok'), [Symbol.for('hypequery.mcp-source.v1')]: { version: 1, datasets, resolveAnalytics: () => analytics } };
`);
    const outputs = [];
    for (const mode of ['off', 'debug', 'failing'] as const) {
      const env = { ...process.env, HYPEQUERY_CONFIG_DIR: directory };
      for (const key of ['VITEST', 'NODE_ENV', 'DO_NOT_TRACK', 'HYPEQUERY_TELEMETRY_DISABLED', 'HYPEQUERY_TELEMETRY_URL', 'HYPEQUERY_TELEMETRY_DEBUG', 'GITHUB_ACTIONS']) delete env[key];
      if (mode === 'debug') env.HYPEQUERY_TELEMETRY_DEBUG = '1';
      else if (mode === 'failing') env.HYPEQUERY_TELEMETRY_URL = 'http://127.0.0.1:1/batch';
      else env.HYPEQUERY_TELEMETRY_DISABLED = '1';
      const child = spawn(process.execPath, [bin, 'mcp', file], { cwd: directory, env, stdio: ['pipe', 'pipe', 'pipe'] });
      let stdout = '';
      let stderr = '';
      let pending = '';
      const replies = new Map<number, (value: Record<string, unknown>) => void>();
      const closed = new Promise<number | null>((resolve, reject) => { child.once('error', reject); child.once('close', resolve); });
      const timer = setTimeout(() => child.kill('SIGKILL'), 8_000);
      child.stderr.on('data', chunk => { stderr += chunk.toString(); });
      child.stdout.on('data', chunk => {
        stdout += chunk.toString(); pending += chunk.toString();
        const lines = pending.split('\n'); pending = lines.pop()!;
        for (const line of lines) {
          const response = JSON.parse(line);
          replies.get(response.id)?.(response);
        }
      });
      const request = (id: number, method: string, params?: unknown) => Promise.race([new Promise<Record<string, unknown>>(resolve => {
        replies.set(id, resolve);
        child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, ...(params ? { params } : {}) }) + '\n');
      }), closed.then(() => { throw new Error(`MCP exited before replying: ${stderr}`); })]);
      try {
        expect(await request(1, 'initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'PRIVATE_CLIENT', version: 'PRIVATE_VERSION' } })).toHaveProperty('result');
        child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');
        expect(await request(2, 'tools/list')).toHaveProperty('result.tools');
        expect(await request(3, 'tools/call', { name: 'list_datasets', arguments: {} })).not.toHaveProperty('result.isError', true);
        expect(await request(4, 'tools/call', { name: 'get_dataset_schema', arguments: { dataset: 'PRIVATE_DATASET' } })).not.toHaveProperty('result.isError', true);
        expect(await request(5, 'tools/call', { name: 'query_dataset', arguments: { dataset: 'PRIVATE_DATASET', measures: ['PRIVATE_MEASURE'] } })).not.toHaveProperty('result.isError', true);
        expect(await request(6, 'tools/call', { name: 'query_dataset', arguments: { dataset: 'PRIVATE_UNKNOWN_DATASET', measures: ['PRIVATE_MEASURE'] } })).toHaveProperty('result.isError', true);
        child.kill('SIGINT');
        expect(await closed).toBe(0);
        expect(stdout.trim().split('\n').map(line => JSON.parse(line).id)).toEqual([1, 2, 3, 4, 5, 6]);
        outputs.push(stdout);
        const events = stderr.split('\n').flatMap(line => { try { const event = JSON.parse(line); return event.event ? [event] : []; } catch { return []; } });
        expect(events).toHaveLength(mode === 'debug' ? 3 : 0);
        if (mode === 'debug') {
          expect(events[1]).toMatchObject({ event: 'cli_session_ended', properties: { command: 'mcp', outcome: 'interrupted', tool_call_counts: { list: '1', describe: '1', query: '2-5' }, error_count_bucket: '1' } });
          expect(JSON.stringify(events)).not.toContain('PRIVATE');
          expect(stderr).not.toContain('Hypequery collects');
        }
      } finally { clearTimeout(timer); child.kill('SIGKILL'); }
    }
    expect(outputs[1]).toBe(outputs[0]);
    expect(outputs[2]).toBe(outputs[0]);
  }, 30_000);
});
