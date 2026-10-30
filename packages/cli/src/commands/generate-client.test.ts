import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, readFile, writeFile, rm, symlink, stat, realpath, chmod } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { decodeProtocolClientContract, prepareProtocolClientContract } from '@hypequery/protocol';
import { generateClientCommand } from './generate-client.js';
import { GENERATED_CLIENT_HEADER, renderClientContract } from '../generators/client-contract/render.js';
import { flagNames } from '../utils/telemetry/flags.js';
import { TelemetryInvocation } from '../utils/telemetry/invocation.js';
import { CommandLifecycle } from '../utils/telemetry/lifecycle.js';
import { withCommandTelemetry } from '../utils/telemetry/command-context.js';
import { CommandExit } from '../utils/command-exit.js';
import { validateTelemetryEvent } from '../utils/telemetry/validation.js';
import { common } from '../../type-tests/fixtures.js';

vi.mock('../utils/logger.js', () => ({ logger: { success: vi.fn(), error: vi.fn() } }));
const vectors = JSON.parse(await readFile(new URL('../../../../specs/security-protocol/fixtures/client-contract-v1/success.json', import.meta.url), 'utf8'));
const contract = vectors[0].value;
const temporary: string[] = [];
async function project() {
  const directory = await realpath(await mkdtemp(path.join(tmpdir(), 'hq-client-')));
  temporary.push(directory);
  const input = path.join(directory, 'PRIVATE_INPUT.json');
  const output = path.join(directory, 'PRIVATE_OUTPUT.ts');
  await writeFile(input, JSON.stringify(contract));
  return { directory, input, output };
}
afterEach(async () => {
  process.exitCode = 0;
  vi.restoreAllMocks();
  await Promise.all(temporary.splice(0).map(directory => rm(directory, { recursive: true, force: true })));
});

describe('offline client generation', () => {
  it('matches a compiled self-contained type fixture and final registered routes', async () => {
    const { input, output } = await project();
    await generateClientCommand(input, { output });
    const generated = await readFile(output, 'utf8');
    expect(generated).toBe(await readFile(new URL('../../type-tests/client-contract.generated.ts', import.meta.url), 'utf8'));
    expect(generated).toContain('schemaHash:');
    expect(generated).toContain('/api/v1/datasets/orders/query');
    expect(generated).not.toMatch(/\bimport\b|clickhouse|fastapi|tenant|sql/i);
  });

  it('is deterministic across object member and endpoint permutations', () => {
    const reversed = JSON.parse(JSON.stringify(contract, (_key, value) => value && typeof value === 'object' && !Array.isArray(value)
      ? Object.fromEntries(Object.entries(value).reverse()) : value));
    reversed.endpoints.reverse();
    // Domain identities sort endpoint sets and descriptor maps.
    expect(renderClientContract(reversed)).toBe(renderClientContract(contract));
  });

  it('checks without writes, refuses replacement and preserves mode on force', async () => {
    const { input, output, directory } = await project();
    const missing = path.join(directory, 'absent', 'client.ts');
    await generateClientCommand(input, { output: missing, check: true });
    expect(process.exitCode).toBe(1);
    await expect(stat(path.dirname(missing))).rejects.toMatchObject({ code: 'ENOENT' });
    process.exitCode = 0;
    await generateClientCommand(input, { output });
    await generateClientCommand(input, { output, check: true });
    expect(process.exitCode).toBe(0);
    const handEdited = `${GENERATED_CLIENT_HEADER} hand edited`;
    await writeFile(output, handEdited);
    await chmod(output, 0o600);
    await expect(generateClientCommand(input, { output })).rejects.toThrow('Refusing');
    await generateClientCommand(input, { output, check: true });
    expect(await readFile(output, 'utf8')).toBe(handEdited);
    expect(process.exitCode).toBe(1);
    await generateClientCommand(input, { output, force: true });
    expect((await stat(output)).mode & 0o777).toBe(0o600);
  });

  it.each(['duplicate', 'identity', 'javascript', 'oversize', 'utf8', 'authorized'])('refuses %s before creating output', async mode => {
    const { input, output } = await project();
    if (mode === 'duplicate') await writeFile(input, '{"kind":1,"kind":2}');
    if (mode === 'identity') await writeFile(input, JSON.stringify({ ...contract, contentHash: '0'.repeat(64) }));
    if (mode === 'javascript') await writeFile(input, "throw new Error('MUST_NOT_EVALUATE')");
    if (mode === 'oversize') await writeFile(input, ' '.repeat(1_048_577));
    if (mode === 'utf8') await writeFile(input, Buffer.from([0xff]));
    if (mode === 'authorized') {
      const unsigned = structuredClone(contract);
      delete unsigned.contentHash;
      unsigned.view = 'authorized';
      unsigned.endpoints = unsigned.endpoints.map(({ schemaHash: _schema, ...endpoint }: Record<string, unknown>) => endpoint);
      await writeFile(input, prepareProtocolClientContract(unsigned).canonical);
    }
    await expect(generateClientCommand(input, { output })).rejects.toThrow();
    await expect(stat(output)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('refuses symlinked output and same-file overwrite', async () => {
    const { input, output } = await project();
    await symlink(input, output);
    await expect(generateClientCommand(input, { output, force: true })).rejects.toThrow('regular file');
    await expect(generateClientCommand(input, { output: input, force: true })).rejects.toThrow('different files');
    expect(decodeProtocolClientContract(await readFile(input, 'utf8')).contentHash).toBe(contract.contentHash);
  });

  it('names an unknown contract field and suggests upgrading the CLI', async () => {
    const { input, output } = await project();
    await writeFile(input, JSON.stringify({ ...contract, endpoints: [{ ...contract.endpoints[0], newerField: {} }, ...contract.endpoints.slice(1)] }));
    await expect(generateClientCommand(input, { output })).rejects.toThrow(
      'Unknown client contract field at /endpoints/0/newerField (HQ_CLIENT_UNKNOWN_FIELD). The contract may come from a newer hypequery than this CLI; upgrade @hypequery/cli.',
    );
    await expect(stat(output)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('refuses conflicting flags', async () => {
    const { input, output } = await project();
    await expect(generateClientCommand(input, { output, check: true, force: true })).rejects.toThrow('--force');
  });

  it('handles prototype-like metric names without emitting object prototype setters', () => {
    const unsigned = structuredClone(contract);
    delete unsigned.contentHash;
    const endpoint = unsigned.endpoints.find((entry: { kind: string }) => entry.kind === 'metric');
    unsigned.endpoints = [{ ...endpoint, id: '__proto__', schemaHash: undefined }];
    delete unsigned.endpoints[0].schemaHash;
    const generated = renderClientContract(prepareProtocolClientContract(unsigned).contract);
    expect(generated).toContain('["__proto__"]: { method:');
  });

  it('emits backend annotations as escaped JSDoc without changing identities', () => {
    const annotated = vectors.find((entry: { id: string }) => entry.id === 'annotated').value;
    const generated = renderClientContract(annotated);
    expect(generated).toContain('  /** Orders — One row per customer order. */\n  "dataset:orders":');
    expect(generated).toContain('  /** Revenue — Gross order value in €, before refunds. */\n  "ordersRevenue":');
    expect(generated).toContain('/** Tier of the ordering customer. */\nreadonly "customer.tier"?:');
    // Only text differs: the routing manifest and endpoint pins match the unannotated build.
    const manifest = (source: string) => source.slice(source.indexOf('export const clientManifest'), source.indexOf('export const clientContractHash'));
    expect(manifest(generated)).toBe(manifest(renderClientContract(contract)));
    const unsigned = structuredClone(annotated);
    delete unsigned.contentHash;
    for (const endpoint of unsigned.endpoints) delete endpoint.schemaHash;
    unsigned.endpoints[0].annotations = { description: 'Ends early */ export const injected = 1; /*' };
    const hostile = renderClientContract(prepareProtocolClientContract(unsigned).contract);
    expect(hostile).toContain('/** Ends early *\\/ export const injected = 1; /* */');
    expect(hostile).not.toMatch(/early \*\/ export/);
  });

  it('reports only safe flags and bucketed endpoint counts', async () => {
    const { input, output } = await project();
    const record = vi.fn();
    vi.spyOn(TelemetryInvocation, 'create').mockResolvedValue({ common, record, flush: vi.fn() } as unknown as TelemetryInvocation);
    const lifecycle = new CommandLifecycle(['generate:client']);
    await lifecycle.begin('generate:client');
    await withCommandTelemetry(lifecycle, () => generateClientCommand(input, { output }));
    await lifecycle.finish(new CommandExit(0, 'success'));
    const event = record.mock.calls[0][0];
    expect(validateTelemetryEvent(event)).toBe(true);
    expect(event.properties).toMatchObject({ mode: 'write', endpoint_count_bucket: '2-5', custom_output: true });
    expect(JSON.stringify(event)).not.toMatch(/PRIVATE|orders|countries|schemaHash/);
    expect(flagNames('generate:client', [input, '--output', '--force', '--check'])).toEqual(['--check', '--output']);
  });
});

describe('client generation from the live Cloud release', () => {
  const env = {
    HYPEQUERY_DEPLOYMENT_ENDPOINT: 'https://cloud.example.test/v1/deployments/submissions',
    HYPEQUERY_API_TOKEN: 'hqdp_token',
  };
  const target = { project: 'acme', environment: 'production' };

  it('fetches the target contract with the deployment credential and records where it is served', async () => {
    const { output } = await project();
    const fetch = vi.fn(async () => new Response(JSON.stringify(contract)));
    const fetchEndpoints = vi.fn(async () => ({
      active: true,
      rest: { baseUrl: 'https://acme-production.hypequery.app/', datasets: [] },
      mcp: { url: 'https://acme-production.hypequery.app/mcp' },
    }));
    await generateClientCommand(undefined, { cloud: true, output, ...target }, { env, fetch, fetchEndpoints });

    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://cloud.example.test/v1/deployments/targets/acme/production/client-contract');
    expect(init.headers).toMatchObject({ Authorization: 'Bearer hqdp_token' });
    expect(init.redirect).toBe('error');
    const generated = await readFile(output, 'utf8');
    expect(generated).toBe(`${renderClientContract(contract)}export const clientBaseUrl = "https://acme-production.hypequery.app" as const;\n`);
  });

  it('names what to do when Cloud has no contract or refuses the credential', async () => {
    const { output } = await project();
    const fetchEndpoints = vi.fn(async () => undefined);
    await expect(generateClientCommand(undefined, { cloud: true, output, ...target }, {
      env, fetchEndpoints, fetch: vi.fn(async () => new Response('', { status: 404 })),
    })).rejects.toThrow('publish a release first');
    await expect(generateClientCommand(undefined, { cloud: true, output, ...target }, {
      env, fetchEndpoints, fetch: vi.fn(async () => new Response('', { status: 401 })),
    })).rejects.toThrow('hypequery login');
  });

  it('refuses a base URL the generated client cannot call', async () => {
    const { output } = await project();
    const fetch = vi.fn(async () => new Response(JSON.stringify(contract)));
    const served = (baseUrl: string | undefined) => vi.fn(async () => baseUrl === undefined ? undefined : ({
      active: true,
      rest: { baseUrl, datasets: [] },
      mcp: { url: 'https://acme-production.hypequery.app/mcp' },
    }));
    await expect(generateClientCommand(undefined, { cloud: true, output, ...target }, { env, fetch, fetchEndpoints: served(undefined) }))
      .rejects.toThrow('no base URL');
    await expect(generateClientCommand(undefined, { cloud: true, output, ...target }, {
      env, fetch, fetchEndpoints: served('https://cloud.example.test/api/gateway/acme/production/execute'),
    })).rejects.toThrow('Rename that endpoint path');
    await expect(generateClientCommand(undefined, { cloud: true, output, ...target }, {
      env, fetch, fetchEndpoints: served('http://acme-production.hypequery.app'),
    })).rejects.toThrow('not https');
    await expect(stat(output)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('refuses an oversized contract before and while reading it', async () => {
    const { output } = await project();
    const fetchEndpoints = vi.fn(async () => undefined);
    const declared = new Response('{}', { headers: { 'content-length': String(2 * 1_048_576) } });
    await expect(generateClientCommand(undefined, { cloud: true, output, ...target }, {
      env, fetchEndpoints, fetch: vi.fn(async () => declared),
    })).rejects.toThrow('exceeds');
    const streamed = new Response(new ReadableStream({
      start(controller) {
        controller.enqueue(new Uint8Array(1_048_576));
        controller.enqueue(new Uint8Array(1));
        controller.close();
      },
    }));
    await expect(generateClientCommand(undefined, { cloud: true, output, ...target }, {
      env, fetchEndpoints, fetch: vi.fn(async () => streamed),
    })).rejects.toThrow('exceeds');
  });

  it('never overwrites a file it did not generate, even with --force', async () => {
    const { input, output } = await project();
    await writeFile(output, 'export const mine = 1;');
    await expect(generateClientCommand(input, { output, force: true })).rejects.toThrow('not generated by hypequery');
    expect(await readFile(output, 'utf8')).toBe('export const mine = 1;');
  });

  it('takes a contract file or --cloud, and Cloud options only with --cloud', async () => {
    const { input, output } = await project();
    await expect(generateClientCommand(input, { cloud: true, output })).rejects.toThrow('not both');
    await expect(generateClientCommand(undefined, { output })).rejects.toThrow('--cloud for the live Cloud release');
    await expect(generateClientCommand(input, { output, project: 'acme' })).rejects.toThrow('only with --cloud');
  });
});
