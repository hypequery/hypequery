import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, readFile, writeFile, rm, symlink, stat, realpath, chmod } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { decodeProtocolClientContract, prepareProtocolClientContract } from '@hypequery/protocol';
import { generateClientCommand } from './generate-client.js';
import { renderClientContract } from '../generators/client-contract/render.js';
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
    await writeFile(output, 'hand edited');
    await chmod(output, 0o600);
    await expect(generateClientCommand(input, { output })).rejects.toThrow('Refusing');
    await generateClientCommand(input, { output, check: true });
    expect(await readFile(output, 'utf8')).toBe('hand edited');
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
