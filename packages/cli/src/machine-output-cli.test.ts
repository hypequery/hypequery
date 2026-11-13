import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { program } from './cli.js';
import { CLI_ERROR_CATEGORIES } from './utils/cli-error.js';
import { EXIT_CODES } from './utils/exit-codes.js';

const execute = promisify(execFile);
const bin = path.resolve('dist/bin/cli.js');

/**
 * AG-07-b: every command, run headless the way coding agents run it (stdin and
 * stdout are pipes, so there is no TTY), prints exactly one JSON document on
 * stdout with --json, exits with a documented code, and never waits for input.
 */
describe('compiled CLI machine output (--json, exit codes, no TTY)', { timeout: 60_000 }, () => {
  let directory: string;
  let config: string;
  let examplesIndex: string;

  beforeAll(async () => {
    directory = await mkdtemp(path.join(tmpdir(), 'hq-cli-json-'));
    config = await mkdtemp(path.join(tmpdir(), 'hq-cli-json-config-'));
    examplesIndex = path.join(config, 'examples.json');
    await writeFile(examplesIndex, JSON.stringify({
      version: 1,
      packageVersions: { '@hypequery/clickhouse': '2.0.0' },
      entries: [{
        slug: 'demo-dashboard', kind: 'example', title: 'Demo', outcome: 'A demo', dir: 'examples/demo-dashboard',
        url: 'https://hypequery.com/examples/demo-dashboard', markdown: '', source: '', packages: [], keywords: [],
      }],
    }));
  });
  afterAll(async () => {
    await rm(directory, { recursive: true, force: true });
    await rm(config, { recursive: true, force: true });
  });

  async function run(args: string[], options: { cwd?: string; env?: NodeJS.ProcessEnv } = {}) {
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      HYPEQUERY_TELEMETRY_DISABLED: '1',
      HYPEQUERY_CONFIG_DIR: config,
      HYPEQUERY_EXAMPLES_INDEX: examplesIndex,
      ...options.env,
    };
    for (const key of [
      'VITEST', 'CI', 'CLICKHOUSE_URL', 'CLICKHOUSE_HOST', 'CLICKHOUSE_DATABASE', 'CLICKHOUSE_USERNAME',
      'CLICKHOUSE_USER', 'CLICKHOUSE_PASSWORD', 'HYPEQUERY_API_TOKEN', 'HYPEQUERY_DEPLOYMENT_ENDPOINT', 'HYPEQUERY_API_KEY',
    ]) {
      if (!options.env || !(key in options.env)) delete env[key];
    }
    let result: { stdout: string; stderr: string; code?: number };
    try {
      result = await execute(process.execPath, [bin, ...args], { cwd: options.cwd ?? directory, env, timeout: 20_000 });
    } catch (error) {
      result = error as typeof result;
    }
    return { code: result.code ?? 0, stdout: result.stdout, stderr: result.stderr };
  }

  /** stdout must be one JSON document; a non-zero exit always carries the envelope. */
  async function runJson(args: string[], options?: Parameters<typeof run>[1]) {
    const result = await run([...args, '--json'], options);
    let document: any;
    try {
      document = JSON.parse(result.stdout);
    } catch {
      throw new Error(`stdout is not one JSON document (exit ${result.code}):\n${result.stdout}\n--- stderr ---\n${result.stderr}`);
    }
    expect(result.stdout.trimEnd().split('\n')[0]).toBe('{');
    if (result.code === 0) {
      expect(document).not.toHaveProperty('error');
    } else {
      expect(Object.keys(document)).toEqual(['error']);
      expect(document.error).toEqual(expect.objectContaining({
        code: expect.any(String),
        message: expect.any(String),
        hint: expect.any(String),
        docsUrl: expect.stringMatching(/^https:\/\/hypequery\.com\/docs\//),
        category: expect.any(String),
        retryable: expect.any(Boolean),
        correctable: expect.any(Boolean),
        exitCode: result.code,
      }));
      expect(document.error.code).toMatch(/^[A-Z][A-Z0-9_]+$/);
      expect(CLI_ERROR_CATEGORIES).toContain(document.error.category);
      expect(document.error.correctable).toBe(document.error.category === 'correctable_input');
    }
    expect(result.stdout).not.toMatch(/\u001b\[/);
    return { ...result, document };
  }

  it('offers --json and --no-input on every command', () => {
    const flags = program.options.map(option => option.long);
    expect(flags).toContain('--json');
    expect(flags).toContain('--no-input');
  });

  it('no command prints the placeholder result', async () => {
    const { document } = await runJson(['telemetry', 'status']);
    expect(document).not.toEqual({ ok: true });
  });

  it('telemetry', async () => {
    const { code, document } = await runJson(['telemetry', 'status']);
    expect(code).toBe(0);
    expect(document).toEqual(expect.objectContaining({ action: 'status', enabled: false, source: expect.any(String), docsUrl: expect.any(String) }));
    const usage = await runJson(['telemetry', 'sideways']);
    expect(usage.code).toBe(EXIT_CODES.correctable);
    expect(usage.document.error.code).toBe('USAGE');
  });

  it('examples', async () => {
    const { code, document } = await runJson(['examples', 'list']);
    expect(code).toBe(0);
    expect(document).toMatchObject({ version: 1, entries: [{ slug: 'demo-dashboard' }] });
    const kind = await runJson(['examples', 'list', '--kind', 'tutorial']);
    expect(kind.document.error).toMatchObject({ code: 'INVALID_INPUT', issues: [{ path: '--kind' }] });
  });

  it('create', async () => {
    const { code, document } = await runJson(['create', 'no-such-example']);
    expect(code).toBe(1);
    expect(document.error.code).toBe('NOT_FOUND');
  });

  it('skill', async () => {
    const cwd = await mkdtemp(path.join(directory, 'skill-'));
    const installed = await runJson(['skill', 'install', '--agent', 'claude'], { cwd });
    expect(installed.code).toBe(0);
    expect(installed.document).toMatchObject({ upToDate: true });
    expect(installed.document.files.length).toBeGreaterThan(0);
    const fresh = await runJson(['skill', 'install', '--agent', 'claude', '--check'], { cwd });
    expect(fresh.document).toMatchObject({ upToDate: true, installed: [], files: [] });
    await writeFile(installed.document.files[0], 'edited\n');
    const stale = await runJson(['skill', 'install', '--agent', 'claude', '--check'], { cwd });
    expect(stale.code).toBe(1);
    expect(stale.document.error).toMatchObject({ code: 'OUT_OF_DATE', category: 'stale_contract', correctable: false, issues: [{ path: installed.document.files[0], message: 'out of date' }] });
    const conflict = await runJson(['skill', 'install', '--agent', 'claude'], { cwd });
    expect(conflict.document.error).toMatchObject({ code: 'OUTPUT_EXISTS', issues: [{ path: installed.document.files[0] }] });
  });

  it('login and logout', async () => {
    const login = await runJson(['login', '--no-input']);
    expect(login.code).toBe(EXIT_CODES.auth);
    expect(login.document.error).toMatchObject({ code: 'LOGIN_NEEDS_A_PERSON', category: 'unauthenticated' });
    expect(login.document.error.hint).toContain('HYPEQUERY_API_TOKEN');
    const ci = await runJson(['login'], { env: { CI: 'true' } });
    expect(ci.code).toBe(EXIT_CODES.auth);
    const logout = await runJson(['logout']);
    expect(logout.code).toBe(0);
    expect(logout.document).toMatchObject({ signedIn: false });
  });

  it.each([
    [['pull']],
    [['diff']],
    [['deployment:status']],
    [['generate:client', '--cloud']],
    [['deploy', 'analytics/cloud.ts']],
  ])('%j needs a Cloud credential (exit 2)', async (args) => {
    const { code, document } = await runJson(args);
    expect(code).toBe(EXIT_CODES.auth);
    expect(document.error).toMatchObject({ code: 'CLOUD_NOT_SIGNED_IN', category: 'unauthenticated' });
  });

  it('an endpoint or token alone is a configuration error to correct', async () => {
    const endpoint = await runJson(['deployment:status'], { env: { HYPEQUERY_DEPLOYMENT_ENDPOINT: 'https://cloud.example.test/api/deployments/submissions' } });
    expect(endpoint.document.error.code).toBe('CLOUD_ENDPOINT_WITHOUT_TOKEN');
    const token = await runJson(['deployment:status'], { env: { HYPEQUERY_API_TOKEN: 'hqdp_xxxxxxxxxxxxxxxxxxxx' } });
    expect(token.document.error.code).toBe('CLOUD_TOKEN_WITHOUT_ENDPOINT');
  });

  it('init never prompts without a terminal and names what to pass', async () => {
    const cwd = await mkdtemp(path.join(directory, 'init-'));
    const plain = await run(['init'], { cwd });
    expect(plain.code).toBe(1);
    expect(plain.stderr).toContain('--no-interactive');
    const { code, document } = await runJson(['init'], { cwd });
    expect(code).toBe(1);
    expect(document.error).toMatchObject({ code: 'INPUT_REQUIRED', hint: expect.stringContaining('--no-interactive') });
    const unattended = await runJson(['init', '--no-interactive'], { cwd });
    expect(unattended.document.error).toMatchObject({ code: 'INPUT_REQUIRED', message: expect.stringContaining('CLICKHOUSE_URL') });
  });

  it('init refuses to overwrite without --force instead of silently exiting 0', async () => {
    const cwd = await mkdtemp(path.join(directory, 'init-existing-'));
    await mkdir(path.join(cwd, 'analytics'));
    await writeFile(path.join(cwd, 'analytics', 'client.ts'), '// mine\n');
    const { code, document } = await runJson(['init', '--no-interactive', '--skip-connection'], {
      cwd,
      env: { CLICKHOUSE_URL: 'http://127.0.0.1:1', CLICKHOUSE_DATABASE: 'default', CLICKHOUSE_USERNAME: 'default' },
    });
    expect(code).toBe(1);
    expect(document.error).toMatchObject({ code: 'CONFIRMATION_REQUIRED', issues: [{ path: path.join('analytics', 'client.ts') }] });
    expect(document.error.message).toContain('--force');
    expect(await readFile(path.join(cwd, 'analytics', 'client.ts'), 'utf8')).toBe('// mine\n');
  });

  it.each([
    [['generate']],
    [['generate:types']],
    [['generate:datasets']],
  ])('%j reports an unreachable ClickHouse as transient (exit 4)', async (args) => {
    const { code, document } = await runJson(args, { env: { CLICKHOUSE_URL: 'http://127.0.0.1:1', CLICKHOUSE_DATABASE: 'default', CLICKHOUSE_USERNAME: 'default' } });
    expect(code).toBe(EXIT_CODES.transient);
    expect(document.error).toMatchObject({ code: 'CONNECTION_FAILED', retryable: true });
  });

  it('generate:datasets rejects conflicting flags as usage', async () => {
    const { code, document } = await runJson(['generate:datasets', '--force', '--check']);
    expect(code).toBe(1);
    expect(document.error.code).toBe('USAGE');
  });

  it('generate:manifest and export:client-contract report a missing module', async () => {
    for (const args of [['generate:manifest', 'missing/api.ts'], ['export:client-contract', 'missing/api.ts']]) {
      const { code, document } = await runJson(args);
      expect(code).toBe(1);
      expect(document.error.code).toBe('NOT_FOUND');
    }
  });

  it('generate:client reads a contract file and reports problems with it', async () => {
    const usage = await runJson(['generate:client']);
    expect(usage.document.error.code).toBe('USAGE');
    const missing = await runJson(['generate:client', 'missing-contract.json']);
    expect(missing.code).toBe(1);
  });

  it('deployment:validate', async () => {
    const valid = path.join(directory, 'deployment.json');
    await writeFile(valid, JSON.stringify({ kind: 'hypequery-deployment', version: 2, datasets: [] }));
    const ok = await runJson(['deployment:validate', valid]);
    expect(ok.code).toBe(0);
    expect(ok.document).toMatchObject({ valid: true, kind: 'contract', path: valid, deployment: { identity: expect.any(String), datasets: [] } });
    const broken = path.join(directory, 'broken.json');
    await writeFile(broken, '{');
    const invalid = await runJson(['deployment:validate', broken]);
    expect(invalid.code).toBe(1);
    expect(invalid.document.error.code).toBe('INVALID_INPUT');
  });

  it('deployment:build, deployment:release and deployment:submit fail with typed errors', async () => {
    const build = await runJson(['deployment:build', 'missing/cloud.ts']);
    expect(build.document.error.code).toBe('NOT_FOUND');
    const release = await runJson(['deployment:release', 'missing-bundle', '--project', 'p']);
    expect(release.document.error).toMatchObject({ code: 'INPUT_REQUIRED', message: expect.stringContaining('--environment') });
    // Commander rejects the missing required option before the command runs.
    const submit = await runJson(['deployment:submit', 'missing-bundle']);
    expect(submit.code).toBe(1);
    expect(submit.document.error.code).toBe('USAGE');
  });

  it('dev and mcp report a missing entrypoint', async () => {
    const cwd = await mkdtemp(path.join(directory, 'empty-'));
    const dev = await runJson(['dev', '--no-watch'], { cwd });
    expect(dev.code).toBe(1);
    expect(dev.document.error.code).toBe('ENTRYPOINT_NOT_FOUND');
    const mcp = await runJson(['mcp', '--self-test'], { cwd });
    expect(mcp.code).toBe(1);
    expect(mcp.document.error.code).toBe('ENTRYPOINT_NOT_FOUND');
    const serving = await runJson(['mcp'], { cwd });
    expect(serving.document.error.code).toBe('JSON_NOT_SUPPORTED');
    const hosted = await runJson(['mcp', '--self-test', '--url', 'http://example.test/mcp'], { cwd, env: { HYPEQUERY_API_KEY: 'hq_key' } });
    expect(hosted.document.error).toMatchObject({ code: 'MCP_CHECK_FAILED', exitCode: 1 });
  });

  it('unknown options are usage errors with an envelope', async () => {
    const { code, document } = await runJson(['generate', '--bogus']);
    expect(code).toBe(1);
    expect(document.error).toMatchObject({ code: 'USAGE', category: 'correctable_input' });
  });
});
