import { Readable } from 'node:stream';
import type { Command } from 'commander';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { program } from '../cli.js';
import { CommandExit } from '../utils/command-exit.js';
import type { CloudCommandField, CloudCommandShape } from '../utils/cloud-operations/command-shape.js';
import { disableJsonOutput, enableJsonOutput } from '../utils/machine-output.js';
import { CLOUD_COMMAND_SHAPES, cloudOperationOf, cloudOperationValueFlags, runCloudOperation } from './cloud-operations.js';
import { flagNames } from '../utils/telemetry/flags.js';

/**
 * AG-09f: `hypequery <group> <action>` for every Cloud operation, against a
 * mocked Cloud. A generic pass runs every command (help, flags to input,
 * --json output, destructive refusal, error envelope); then one realistic
 * command per group, and the behaviour around secrets, prompts and defaults.
 */

const TOKEN = `hqmt_v1_${'a'.repeat(43)}`;
const CLOUD = 'https://cloud.test';
const REVISION = 'a'.repeat(64);

interface Recorded {
  readonly method: string;
  readonly url: URL;
  readonly headers: Record<string, string>;
  readonly body: Record<string, unknown> | undefined;
}

let requests: Recorded[];
let respond: (request: Recorded) => Response;
let stdout: string[];
let stderr: string[];
const stdinTty = process.stdin.isTTY;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

const fetchMock = vi.fn(async (url: string, init: RequestInit) => {
  const request: Recorded = {
    method: String(init.method),
    url: new URL(url),
    headers: init.headers as Record<string, string>,
    body: typeof init.body === 'string' ? JSON.parse(init.body) as Record<string, unknown> : undefined,
  };
  requests.push(request);
  return respond(request);
});

interface RunResult {
  readonly exitCode: number;
  readonly document: Record<string, any> | undefined;
}

/** Run the real CLI program with --json, as an agent would. */
async function run(argv: readonly string[]): Promise<RunResult> {
  stdout.length = 0;
  let exitCode = 0;
  try {
    await program.parseAsync(['--json', ...argv], { from: 'user' });
  } catch (error) {
    if (!(error instanceof CommandExit)) throw error;
    exitCode = error.exitCode;
  }
  expect(stdout.length, `one JSON document for ${argv.join(' ')}`).toBe(1);
  return { exitCode, document: JSON.parse(stdout[0]!) as Record<string, any> };
}

function commandFor(shape: CloudCommandShape): Command {
  const group = program.commands.find(command => command.name() === shape.group)!;
  return group.commands.find(command => command.name() === shape.action)!;
}

/** A command-line value for a field, and the JSON value it must become. */
function sample(field: CloudCommandField): { readonly argv: readonly string[]; readonly value: unknown } {
  const first = field.choices?.[0];
  switch (field.kind) {
    case 'string': return { argv: [first ?? `${field.property}-value`], value: first ?? `${field.property}-value` };
    case 'integer': return { argv: ['7'], value: 7 };
    case 'number': return { argv: ['2.5'], value: 2.5 };
    case 'boolean': return { argv: [], value: true };
    case 'list': {
      const second = field.choices?.[1] ?? first;
      return { argv: [first ?? 'one', second ?? 'two, with a comma'], value: [first ?? 'one', second ?? 'two, with a comma'] };
    }
    case 'json': return { argv: ['{"sample":1}'], value: { sample: 1 } };
  }
}

/** Every field of the operation on the command line, and the input Cloud should receive. */
function fullInvocation(shape: CloudCommandShape) {
  const positionals: string[] = [];
  const options: string[] = [];
  const secrets: Record<string, unknown> = {};
  const expected: Record<string, unknown> = {};
  for (const field of shape.fields) {
    if (field.placement === 'confirm') continue;
    if (field.placement === 'project') {
      options.push('--project', 'shop');
      expected.project = 'shop';
      continue;
    }
    if (field.placement === 'secret') {
      secrets[field.property] = 's3cret';
      expected[field.property] = 's3cret';
      continue;
    }
    const { argv, value } = sample(field);
    expected[field.property] = value;
    if (field.placement === 'argument') positionals.push(argv[0]!);
    else if (field.kind === 'boolean') options.push(field.flag);
    else if (field.kind === 'list') for (const item of argv) options.push(field.flag, item);
    else options.push(field.flag, argv[0]!);
  }
  if (Object.keys(secrets).length > 0) options.push('--input-json', JSON.stringify(secrets));
  return { argv: [shape.group, shape.action, ...positionals, ...options], expected };
}

/** What Cloud received, path parameters included, with query strings read back as text. */
function received(shape: CloudCommandShape, request: Recorded): Record<string, unknown> {
  const pattern = new RegExp(`^/v1${shape.operation.path.replace(/\{([A-Za-z0-9]+)\}/g, '(?<$1>[^/]+)')}$`);
  const match = pattern.exec(request.url.pathname);
  expect(match, `${request.url.pathname} matches ${shape.operation.path}`).not.toBeNull();
  const fromPath = Object.fromEntries(Object.entries(match!.groups ?? {}).map(([name, value]) => [name, decodeURIComponent(value)]));
  const rest = request.body ?? Object.fromEntries(request.url.searchParams);
  return { ...fromPath, ...rest };
}

function asQuery(value: unknown): unknown {
  return typeof value === 'object' && value !== null ? value : String(value);
}

beforeAll(() => {
  Object.defineProperty(process.stdin, 'isTTY', { value: false, configurable: true });
});

afterAll(() => {
  Object.defineProperty(process.stdin, 'isTTY', { value: stdinTty, configurable: true });
});

beforeEach(() => {
  requests = [];
  stdout = [];
  stderr = [];
  respond = (request) => json({ ok: true, path: request.url.pathname });
  vi.stubEnv('HYPEQUERY_API_TOKEN', TOKEN);
  vi.stubEnv('HYPEQUERY_CLOUD_URL', CLOUD);
  vi.stubEnv('CI', '');
  vi.stubGlobal('fetch', fetchMock);
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  vi.spyOn(process.stderr, 'write').mockImplementation(((text: string) => {
    stderr.push(String(text));
    return true;
  }) as typeof process.stderr.write);
  enableJsonOutput((text) => { stdout.push(text); });
});

afterEach(() => {
  disableJsonOutput();
  program.setOptionValue('json', undefined);
  process.exitCode = undefined;
  fetchMock.mockClear();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe.each(CLOUD_COMMAND_SHAPES.map(shape => [`${shape.group} ${shape.action}`, shape] as const))(
  'hypequery %s',
  (_name, shape) => {
    it('renders help naming the operation and every field', () => {
      const command = commandFor(shape);
      let help = '';
      const previous = command.configureOutput();
      command.configureOutput({ ...previous, writeOut: (text) => { help += text; } });
      try {
        command.outputHelp();
      } finally {
        command.configureOutput(previous);
      }
      expect(help).toContain(`Cloud operation: ${shape.operation.name}`);
      for (const field of shape.fields) {
        if (field.placement === 'argument') expect(help).toContain(field.flag.slice(1, -1));
        else if (field.placement !== 'confirm') expect(help).toContain(field.flag);
      }
      if (shape.confirmation !== 'none') expect(help).toContain('--yes');
    });

    it('maps every flag to the input and prints the output as the --json document', async () => {
      const { argv, expected } = fullInvocation(shape);
      const confirm = shape.confirmation === 'none' ? [] : ['--yes'];
      const result = await run([...argv, ...confirm]);
      expect(result.exitCode).toBe(0);
      expect(requests).toHaveLength(1);
      const [request] = requests;
      expect(request!.method).toBe(shape.operation.method);
      expect(request!.url.origin).toBe(CLOUD);
      expect(request!.headers.authorization).toBe(`Bearer ${TOKEN}`);
      const body = received(shape, request!);
      const query = request!.body === undefined;
      const pathParams = new Set([...shape.operation.path.matchAll(/\{([A-Za-z0-9]+)\}/g)].map(match => match[1]));
      for (const [property, value] of Object.entries(expected)) {
        expect(body[property], `${shape.operation.name}.${property}`).toEqual(query || pathParams.has(property) ? asQuery(value) : value);
      }
      if (shape.confirmation !== 'none') expect(body.confirm).toEqual(query ? 'true' : true);
      expect(result.document).toEqual({ ok: true, path: request!.url.pathname });
    });

    it('reports Cloud\'s error envelope with its code, hint, docs URL and request ID', async () => {
      respond = () => json({
        error: {
          code: 'RELEASE_MOVED',
          message: 'The live release changed.',
          hint: 'Read releases.status again, then retry.',
          docsUrl: 'https://hypequery.com/docs/errors/release-moved',
          category: 'stale_contract',
          retryable: false,
          correctable: false,
          requestId: 'req_123',
        },
      }, 409);
      const { argv } = fullInvocation(shape);
      const result = await run([...argv, ...(shape.confirmation === 'none' ? [] : ['--yes'])]);
      expect(result.exitCode).toBe(1);
      expect(result.document!.error).toMatchObject({
        code: 'RELEASE_MOVED',
        message: 'The live release changed.',
        hint: 'Read releases.status again, then retry.',
        docsUrl: 'https://hypequery.com/docs/errors/release-moved',
        category: 'stale_contract',
        requestId: 'req_123',
        exitCode: 1,
      });
    });

    if (shape.confirmation === 'required') {
      it('refuses without --yes and without a terminal, before calling Cloud', async () => {
        const { argv } = fullInvocation(shape);
        const result = await run(argv);
        expect(result.exitCode).toBe(1);
        expect(result.document!.error).toMatchObject({
          code: 'CONFIRMATION_REQUIRED',
          hint: 'Run the command again with --yes once the change is agreed.',
          docsUrl: 'https://hypequery.com/docs/errors/confirmation-required',
        });
        expect(requests).toHaveLength(0);
      });
    }
  },
);

describe('a representative command per group', () => {
  const cases: ReadonlyArray<{
    readonly argv: readonly string[];
    readonly method: string;
    readonly path: string;
    readonly query?: Record<string, string>;
    readonly body?: Record<string, unknown>;
  }> = [
    { argv: ['projects', 'list'], method: 'GET', path: '/v1/projects', query: {} },
    {
      argv: ['releases', 'rollback', 'v12', '--project', 'shop', '--expected-revision', REVISION, '--yes'],
      method: 'POST', path: '/v1/projects/shop/releases/v12/rollback', body: { expectedRevision: REVISION, confirm: true },
    },
    { argv: ['drafts', 'list', '--project', 'shop', '--archived', 'true'], method: 'GET', path: '/v1/projects/shop/drafts', query: { archived: 'true' } },
    {
      argv: ['customer-scope', 'confirm-shared', '--project', 'shop', '--dataset', 'orders', '--yes'],
      method: 'POST', path: '/v1/projects/shop/onboarding/customer-scope/confirm', body: { dataset: 'orders', confirm: true },
    },
    {
      argv: ['sample-policy', 'set', '--project', 'shop', '--policy', '{"mode":"none","overrides":[]}'],
      method: 'PUT', path: '/v1/projects/shop/sample-policy', body: { policy: { mode: 'none', overrides: [] } },
    },
    {
      argv: ['connections', 'set-query-history', '--project', 'shop', '--no-enabled', '--expected-revision', '3'],
      method: 'PATCH', path: '/v1/projects/shop/connection/query-history', body: { enabled: false, expectedRevision: 3 },
    },
    {
      argv: ['logs', 'query', '--project', 'shop', '--range', '24h', '--limit', '10'],
      method: 'GET', path: '/v1/projects/shop/logs', query: { range: '24h', limit: '10' },
    },
    { argv: ['usage', 'get'], method: 'GET', path: '/v1/org/usage', query: {} },
    { argv: ['audit', 'list', '--limit', '5'], method: 'GET', path: '/v1/org/audit', query: { limit: '5' } },
    {
      argv: ['tenants', 'create', '--project', 'shop', '--tenant-key', 'acme', '--display-name', 'Acme', '--enabled'],
      method: 'POST', path: '/v1/projects/shop/customers/tenants', body: { tenantKey: 'acme', displayName: 'Acme', enabled: true },
    },
    {
      argv: ['permission-sets', 'create', '--project', 'shop', '--name', 'viewers', '--label', 'Viewers', '--datasets', '"*"',
        '--starter-prompts', 'Revenue, by month', '--starter-prompts', 'Churn'],
      method: 'POST', path: '/v1/projects/shop/customers/permission-sets',
      body: { name: 'viewers', label: 'Viewers', datasets: '*', starterPrompts: ['Revenue, by month', 'Churn'] },
    },
    {
      argv: ['customer-limits', 'set', '--project', 'shop', '--requests-per-minute', 'null', '--daily-executions', '100',
        '--chat-tokens-per-month', 'null'],
      method: 'PATCH', path: '/v1/projects/shop/customers/limits',
      body: { requestsPerMinute: null, dailyExecutions: 100, chatTokensPerMonth: null },
    },
    {
      argv: ['tenant-grants', 'revoke', 'grant_1', '--project', 'shop', '--yes'],
      method: 'DELETE', path: '/v1/projects/shop/customers/mcp-grants/grant_1', query: { confirm: 'true' },
    },
    {
      argv: ['customer-access', 'set-mode', '--project', 'shop', '--mode', 'jwt'],
      method: 'PATCH', path: '/v1/projects/shop/customers/access', body: { mode: 'jwt' },
    },
    {
      argv: ['customer-settings', 'set', '--project', 'shop', '--allowed-origins', 'https://app.example.com',
        '--expected-revision', '0', '--tenant-registration', 'listed'],
      method: 'PATCH', path: '/v1/projects/shop/customers/settings',
      body: { allowedOrigins: ['https://app.example.com'], expectedRevision: 0, tenantRegistration: 'listed' },
    },
    {
      argv: ['jwt-issuer', 'remove', '--project', 'shop', '--yes'],
      method: 'DELETE', path: '/v1/projects/shop/customers/jwt-issuer', query: { confirm: 'true' },
    },
    { argv: ['oidc-client', 'get', '--project', 'shop'], method: 'GET', path: '/v1/projects/shop/customers/oidc-client', query: {} },
    {
      argv: ['signing-keys', 'revoke', 'key_1', '--project', 'shop', '--yes'],
      method: 'DELETE', path: '/v1/projects/shop/customers/signing-keys/key_1', query: { confirm: 'true' },
    },
    {
      argv: ['customer-app', 'set', '--project', 'shop', '--enabled', '--display-name', 'Acme', '--expected-revision', '0', '--yes'],
      method: 'PUT', path: '/v1/projects/shop/customers/app-listing',
      body: { enabled: true, displayName: 'Acme', expectedRevision: 0, confirm: true },
    },
    {
      argv: ['members', 'invite', '--email', 'ada@example.com', '--role', 'member'],
      method: 'POST', path: '/v1/org/members/invitations', body: { email: 'ada@example.com', role: 'member' },
    },
    {
      argv: ['org', 'set-access-policy', '--invite-mode', 'approved-domains', '--approved-domains', 'example.com'],
      method: 'PUT', path: '/v1/org/access-policy', body: { inviteMode: 'approved-domains', approvedDomains: ['example.com'] },
    },
    { argv: ['deploy-keys', 'list', '--project', 'shop'], method: 'GET', path: '/v1/projects/shop/deploy-keys', query: {} },
    {
      argv: ['api-keys', 'create', '--project', 'shop', '--label', 'web', '--tenant-authority', '{"kind":"trusted-server"}',
        '--expires-in-days', '30'],
      method: 'POST', path: '/v1/projects/shop/api-keys',
      body: { label: 'web', tenantAuthority: { kind: 'trusted-server' }, expiresInDays: 30 },
    },
    {
      argv: ['management-tokens', 'revoke', 'token_1', '--yes'],
      method: 'DELETE', path: '/v1/org/management-tokens/token_1', query: { confirm: 'true' },
    },
    {
      argv: ['feedback', 'create', '--kind', 'bug', '--summary', 'releases rollback failed'],
      method: 'POST', path: '/v1/feedback', body: { kind: 'bug', summary: 'releases rollback failed' },
    },
  ];

  it('covers every group', () => {
    const groups = new Set(CLOUD_COMMAND_SHAPES.map(shape => shape.group));
    expect(new Set(cases.map(entry => entry.argv[0]))).toEqual(groups);
  });

  it.each(cases.map(entry => [entry.argv.join(' '), entry] as const))('hypequery %s', async (_name, entry) => {
    const result = await run(entry.argv);
    expect(result.exitCode).toBe(0);
    expect(requests).toHaveLength(1);
    const [request] = requests;
    expect(request!.method).toBe(entry.method);
    expect(request!.url.pathname).toBe(entry.path);
    if (entry.query) expect(Object.fromEntries(request!.url.searchParams)).toEqual(entry.query);
    if (entry.body) expect(request!.body).toEqual(entry.body);
    expect(request!.headers['user-agent']).toMatch(/^hypequery-cli\//);
  });
});

describe('--input-json through the command parser', () => {
  it('takes path parameters from --input-json alone', async () => {
    const result = await run(['releases', 'get', '--input-json', '{"project":"shop","version":"v12"}']);
    expect(result.exitCode).toBe(0);
    expect(requests).toHaveLength(1);
    expect(requests[0]!.url.pathname).toBe('/v1/projects/shop/releases/v12');
  });

  it('lets a positional argument override the same field in --input-json', async () => {
    const result = await run(['releases', 'get', 'v13', '--input-json', '{"project":"shop","version":"v12"}']);
    expect(result.exitCode).toBe(0);
    expect(requests[0]!.url.pathname).toBe('/v1/projects/shop/releases/v13');
  });

  it('still refuses when neither names the path parameter, before calling Cloud', async () => {
    const result = await run(['releases', 'get', '--input-json', '{"project":"shop"}']);
    expect(result.exitCode).toBe(1);
    expect(result.document!.error).toMatchObject({
      code: 'MISSING_INPUT',
      issues: [{ path: '<version>', message: 'required' }],
    });
    expect(requests).toHaveLength(0);
  });

  it('shows path parameters as required in help', () => {
    const command = commandFor(CLOUD_COMMAND_SHAPES.find(shape => shape.operation.name === 'releases.get')!);
    expect(command.helpInformation()).toContain('releases get [options] <version>');
  });
});

describe('exit codes follow Cloud\'s category', () => {
  it('refuses a non-local HTTP endpoint without sending the token', async () => {
    vi.stubEnv('HYPEQUERY_DEPLOYMENT_ENDPOINT', 'http://cloud.example.com/v1/deployments/submissions');
    const result = await run(['projects', 'list']);
    expect(result.exitCode).toBe(1);
    expect(result.document!.error).toMatchObject({ code: 'CLOUD_ENDPOINT_INSECURE', category: 'correctable_input' });
    expect(requests).toEqual([]);
  });

  it.each([
    [401, 'unauthenticated', 2],
    [403, 'forbidden', 2],
    [402, 'budget_exceeded', 3],
    [503, 'unavailable', 4],
    [400, 'correctable_input', 1],
  ])('HTTP %i (%s) exits %i', async (status, category, exitCode) => {
    respond = () => json({
      error: { code: 'X', message: 'no', hint: 'h', docsUrl: 'https://hypequery.com/docs/errors/x', category, retryable: false, correctable: false, requestId: 'r' },
    }, status);
    const result = await run(['projects', 'list']);
    expect(result.exitCode).toBe(exitCode);
    expect(result.document!.error).toMatchObject({ code: 'X', category, exitCode });
  });

  it('reports an unreachable Cloud as transient', async () => {
    respond = () => { throw new TypeError('fetch failed'); };
    const result = await run(['projects', 'list']);
    expect(result.exitCode).toBe(4);
    expect(result.document!.error).toMatchObject({ code: 'NETWORK_ERROR', retryable: true });
  });

  it('refuses before calling Cloud when a required field is missing, naming the flag', async () => {
    const result = await run(['releases', 'rollback', 'v12', '--project', 'shop', '--yes']);
    expect(result.exitCode).toBe(1);
    expect(result.document!.error).toMatchObject({
      code: 'MISSING_INPUT',
      issues: [{ path: '--expected-revision', message: 'required' }],
    });
    expect(requests).toHaveLength(0);
  });

  it('refuses a value that does not fit the field', async () => {
    const result = await run(['logs', 'query', '--project', 'shop', '--limit', 'ten']);
    expect(result.exitCode).toBe(1);
    expect(result.document!.error).toMatchObject({ code: 'INVALID_OPTION', issues: [{ path: '--limit' }] });
    expect(requests).toHaveLength(0);
  });

  it('needs a signed-in credential', async () => {
    vi.stubEnv('HYPEQUERY_API_TOKEN', '');
    const result = await run(['projects', 'list']);
    expect(result.exitCode).toBe(2);
    expect(result.document!.error.code).toBe('CLOUD_NOT_SIGNED_IN');
  });
});

describe('text mode', () => {
  beforeEach(() => {
    disableJsonOutput();
  });

  it('prints the output on stdout and Cloud\'s hint, docs page and request ID on stderr', async () => {
    const written: string[] = [];
    vi.spyOn(process.stdout, 'write').mockImplementation(((text: string) => {
      written.push(String(text));
      return true;
    }) as typeof process.stdout.write);
    await program.parseAsync(['projects', 'list'], { from: 'user' });
    expect(JSON.parse(written.join(''))).toEqual({ ok: true, path: '/v1/projects' });

    respond = () => json({
      error: {
        code: 'PROJECT_NOT_FOUND', message: 'No project "nope".', hint: 'List projects and use one of their slugs.',
        docsUrl: 'https://hypequery.com/docs/errors/project-not-found', category: 'correctable_input',
        retryable: false, correctable: true, requestId: 'req_9',
      },
    }, 404);
    await expect(program.parseAsync(['projects', 'get', '--project', 'nope'], { from: 'user' }))
      .rejects.toMatchObject({ exitCode: 1 });
    const lines = vi.mocked(console.error).mock.calls.map(call => String(call[0]));
    expect(lines).toEqual(expect.arrayContaining([
      'No project "nope".',
      'Hint: List projects and use one of their slugs.',
      'Docs: https://hypequery.com/docs/errors/project-not-found',
      'Request ID: req_9',
      'Code: PROJECT_NOT_FOUND',
    ]));
  });
});

describe('runCloudOperation', () => {
  function shapeOf(name: string): CloudCommandShape {
    return CLOUD_COMMAND_SHAPES.find(shape => shape.operation.name === name)!;
  }

  function terminal(text = ''): NodeJS.ReadableStream & { isTTY: boolean } {
    return Object.assign(Readable.from(text ? [Buffer.from(text)] : []), { isTTY: true });
  }

  function pipe(text: string): NodeJS.ReadableStream & { isTTY: boolean } {
    return Object.assign(Readable.from([Buffer.from(text)]), { isTTY: false });
  }

  beforeEach(() => {
    disableJsonOutput();
  });

  const io = () => {
    const out: string[] = [];
    const err: string[] = [];
    return { out, err, writeStdout: (text: string) => { out.push(text); }, writeStderr: (text: string) => { err.push(text); } };
  };

  it('prints a secret Cloud returns once to stdout only, with a warning on stderr', async () => {
    respond = () => json({ key: { id: 'key_1', token: 'hqak_secret_value' } });
    const streams = io();
    await runCloudOperation(shapeOf('apiKeys.create'), [], {
      project: 'shop', label: 'web', tenantAuthority: '{"kind":"trusted-server"}',
    }, { ...streams, stdin: pipe('') });
    expect(streams.out.join('')).toContain('hqak_secret_value');
    expect(streams.err.join('')).toContain('Cloud shows this secret only once');
    expect(streams.err.join('')).not.toContain('hqak_secret_value');
  });

  it('reads a secret input from stdin with --<field>-stdin, never from argv', async () => {
    const streams = io();
    await runCloudOperation(shapeOf('connections.save'), [], {
      project: 'shop', host: 'https://ch.example.com:8443', database: 'default', username: 'reader', passwordStdin: true,
    }, { ...streams, stdin: pipe('hunter2\n') });
    expect(requests[0]!.body).toMatchObject({ password: 'hunter2', username: 'reader' });
  });

  it('asks for the secret hidden when --<field>-stdin is used at a terminal, where stdin would echo it', async () => {
    const streams = io();
    const promptSecret = vi.fn(async () => 'typed-hidden');
    await runCloudOperation(shapeOf('connections.save'), [], {
      project: 'shop', host: 'https://ch.example.com:8443', database: 'default', username: 'reader', passwordStdin: true,
    }, { ...streams, stdin: terminal('echoed-if-read\n'), promptSecret });
    expect(promptSecret).toHaveBeenCalledWith('password (hidden)');
    expect(requests[0]!.body).toMatchObject({ password: 'typed-hidden' });
  });

  it('prompts for a required secret at a terminal, and refuses without one', async () => {
    const streams = io();
    const promptSecret = vi.fn(async () => 'from-prompt');
    const options = { project: 'shop', host: 'https://ch.example.com', database: 'default', username: 'reader' };
    await runCloudOperation(shapeOf('connections.save'), [], options, { ...streams, stdin: terminal(), promptSecret });
    expect(promptSecret).toHaveBeenCalledWith('password (hidden)');
    expect(requests[0]!.body).toMatchObject({ password: 'from-prompt' });

    await expect(runCloudOperation(shapeOf('connections.save'), [], options, { ...streams, stdin: pipe('') }))
      .rejects.toMatchObject({ code: 'MISSING_INPUT', issues: [{ path: '--password-stdin' }] });
  });

  it('asks before a destructive change at a terminal, and changes nothing when declined', async () => {
    const streams = io();
    const confirm = vi.fn(async () => false);
    await expect(runCloudOperation(shapeOf('members.remove'), ['member_1'], {}, { ...streams, stdin: terminal(), confirm }))
      .rejects.toMatchObject({ code: 'CONFIRMATION_DECLINED' });
    expect(confirm.mock.calls[0]![0]).toContain('members.remove on your organisation');
    expect(requests).toHaveLength(0);

    confirm.mockResolvedValueOnce(true);
    await runCloudOperation(shapeOf('members.remove'), ['member_1'], {}, { ...streams, stdin: terminal(), confirm });
    expect(requests[0]!.url.searchParams.get('confirm')).toBe('true');
  });

  it('confirms a change Cloud asks about (disabling a tenant) with --yes, or at a terminal', async () => {
    let calls = 0;
    respond = (request) => {
      calls += 1;
      if (request.body?.confirm === true) return json({ tenant: { id: 't1', enabled: false } });
      return json({ error: {
        code: 'CONFIRMATION_REQUIRED', message: 'Disabling acme signs out its users.', hint: 'Repeat with confirm: true.',
        docsUrl: 'https://hypequery.com/docs/errors/confirmation-required', category: 'correctable_input',
        retryable: false, correctable: true, requestId: 'req_c',
      } }, 409);
    };
    const streams = io();
    const options = { project: 'shop', enabled: false };
    await expect(runCloudOperation(shapeOf('tenants.update'), ['t1'], options, { ...streams, stdin: pipe('') }))
      .rejects.toMatchObject({ code: 'CONFIRMATION_REQUIRED', hint: 'Run the command again with --yes once the change is agreed.' });

    const confirm = vi.fn(async () => true);
    await runCloudOperation(shapeOf('tenants.update'), ['t1'], options, { ...streams, stdin: terminal(), confirm });
    expect(confirm).toHaveBeenCalledWith('Disabling acme signs out its users. Continue?');

    calls = 0;
    await runCloudOperation(shapeOf('tenants.update'), ['t1'], { ...options, yes: true }, { ...streams, stdin: pipe('') });
    expect(calls).toBe(1);
  });

  it('defaults --project to the signed-in project, for project operations only', async () => {
    vi.stubEnv('HYPEQUERY_API_TOKEN', '');
    vi.stubEnv('HYPEQUERY_CLOUD_URL', '');
    const streams = io();
    const loadManagementCredential = vi.fn(async () => ({
      cloudUrl: CLOUD,
      token: TOKEN,
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      deploymentEndpoint: `${CLOUD}/v1/deployments/submissions`,
      project: 'signed-in',
      projectLimited: true,
      signedInWith: 'device' as const,
    }));
    const dependencies = { ...streams, stdin: pipe(''), loadManagementCredential };
    await runCloudOperation(shapeOf('releases.status'), [], {}, dependencies);
    expect(requests[0]!.url.href).toBe(`${CLOUD}/v1/projects/signed-in/releases/live`);

    await runCloudOperation(shapeOf('releases.status'), [], { project: 'other' }, dependencies);
    expect(requests[1]!.url.pathname).toBe('/v1/projects/other/releases/live');

    await runCloudOperation(shapeOf('feedback.create'), [], { kind: 'bug', summary: 'x' }, dependencies);
    expect(requests[2]!.body).toEqual({ kind: 'bug', summary: 'x' });
  });

  it('takes the whole input as --input-json, with flags on top and its confirm ignored', async () => {
    const streams = io();
    await runCloudOperation(shapeOf('members.invite'), [], {
      inputJson: '{"email":"ada@example.com","role":"admin","confirm":true}', role: 'member',
    }, { ...streams, stdin: pipe('') });
    expect(requests[0]!.body).toEqual({ email: 'ada@example.com', role: 'member' });

    await runCloudOperation(shapeOf('members.invite'), [], { inputJson: '-' }, {
      ...streams, stdin: pipe('{"email":"bob@example.com","role":"member"}'),
    });
    expect(requests[1]!.body).toEqual({ email: 'bob@example.com', role: 'member' });

    await expect(runCloudOperation(shapeOf('members.invite'), [], { inputJson: '[1]' }, { ...streams, stdin: pipe('') }))
      .rejects.toMatchObject({ code: 'INVALID_OPTION' });
  });

  it('never reads an option value as a telemetry flag', () => {
    const flags = (args: readonly string[]) => flagNames('cloud-operation', args, cloudOperationValueFlags(program, args));
    // Values that look like the shared flags are values, whichever option they follow.
    expect(flags(['feedback', 'create', '--kind', 'bug', '--summary', '--yes'])).toEqual([]);
    expect(flags(['feedback', 'create', '--kind', 'bug', '--summary', '-y'])).toEqual([]);
    expect(flags(['--json', 'feedback', 'create', '--summary', '--project', '--kind', '--input-json'])).toEqual(['--json']);
    expect(flags(['members', 'invite', '--email', '--yes', '--role', '--no-telemetry'])).toEqual([]);
    // The shared flags themselves are still reported, and only those.
    expect(flags(['releases', 'rollback', 'v12', '--project', 'shop', '--expected-revision', 'abc', '--yes']))
      .toEqual(['--project', '--yes']);
    expect(flags(['feedback', 'create', '--summary=--yes', '--input-json', '--yes', '-y'])).toEqual(['--input-json', '--yes']);
    // Only value-taking options are stepped over: a boolean field's flag takes none.
    const tenantsUpdate = shapeOf('tenants.update');
    const boolean = tenantsUpdate.fields.find(field => field.placement === 'option' && field.kind === 'boolean');
    if (boolean) {
      expect(flags(['tenants', 'update', 'acme', boolean.flag, '--yes'])).toEqual(['--yes']);
    }
    expect(cloudOperationValueFlags(program, ['deploy', 'cloud.ts'])).toEqual([]);
    expect(cloudOperationValueFlags(program, ['releases', '--help'])).toEqual([]);
  });

  it('is recorded under one telemetry command', () => {
    const command = commandFor(shapeOf('releases.rollback'));
    expect(cloudOperationOf(command)?.operation.name).toBe('releases.rollback');
    expect(cloudOperationOf(program)).toBeUndefined();
  });
});
