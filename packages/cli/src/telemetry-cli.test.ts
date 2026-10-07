import { execFile, spawn } from 'node:child_process';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
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

  async function run(args: string[], mode: 'off' | 'debug' | 'failing', cwd = directory, extraEnv: NodeJS.ProcessEnv = {}) {
    const env = { ...process.env, ...extraEnv, HYPEQUERY_CONFIG_DIR: directory };
    for (const key of ['VITEST', 'NODE_ENV', 'DO_NOT_TRACK', 'HYPEQUERY_TELEMETRY_DISABLED', 'HYPEQUERY_TELEMETRY_URL', 'HYPEQUERY_TELEMETRY_DEBUG', 'GITHUB_ACTIONS']) delete env[key];
    if (mode === 'debug') env.HYPEQUERY_TELEMETRY_DEBUG = '1';
    else if (mode === 'failing') env.HYPEQUERY_TELEMETRY_URL = 'http://127.0.0.1:1/batch';
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
      expect(events).toHaveLength(1);
      expect(events[0].properties).toMatchObject({ command: 'dev', outcome: 'interrupted' });
    } finally { clearTimeout(timer); child.kill('SIGKILL'); }
  }, 10_000);
});
