import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { decodeProtocolClientContract } from '@hypequery/protocol';
import { exportClientContractCommand } from './export-client-contract.js';
import { generateClientCommand } from './generate-client.js';
import { canonicalClientContract } from '../utils/client-contract-canonical.js';
import { disableJsonOutput, emitDefaultResult, enableJsonOutput } from '../utils/machine-output.js';

vi.mock('../utils/logger.js', () => ({ logger: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warn: vi.fn() } }));

const apiFile = fileURLToPath(new URL('../../type-tests/fixtures/serve-client-api.ts', import.meta.url));
// React's type tests compile hooks against this file, so the round trip ends in a type check.
const generatedFixture = new URL('../../../react/type-tests/serve-client-contract.generated.ts', import.meta.url);
const temporary: string[] = [];

async function directory() {
  const created = await realpath(await mkdtemp(path.join(tmpdir(), 'hq-export-')));
  temporary.push(created);
  return created;
}

afterEach(async () => {
  process.exitCode = 0;
  vi.restoreAllMocks();
  await Promise.all(temporary.splice(0).map(created => rm(created, { recursive: true, force: true })));
});

describe('export:client-contract', () => {
  it('round-trips a TypeScript serve API through generate:client', async () => {
    const root = await directory();
    const contract = path.join(root, 'client-contract.json');
    const client = path.join(root, 'hypequery-client.ts');
    await exportClientContractCommand(apiFile, { output: contract });
    const text = await readFile(contract, 'utf8');
    const decoded = decodeProtocolClientContract(text);
    expect(decoded.view).toBe('build');
    expect(decoded.endpoints.map(endpoint => endpoint.path)).toEqual([
      '/api/analytics/datasets/orders/query',
      '/api/analytics/metrics/totalRevenue',
    ]);
    const { api } = await import('../../type-tests/fixtures/serve-client-api.js');
    expect(text).toBe(api.clientContract().canonical);

    await generateClientCommand(contract, { output: client });
    expect(await readFile(client, 'utf8')).toBe(await readFile(generatedFixture, 'utf8'));
  });

  it('checks, refuses to overwrite and replaces with --force', async () => {
    const root = await directory();
    const contract = path.join(root, 'client-contract.json');
    await exportClientContractCommand(apiFile, { output: contract, check: true });
    expect(process.exitCode).toBe(1);
    process.exitCode = 0;
    await writeFile(contract, '{}');
    await expect(exportClientContractCommand(apiFile, { output: contract })).rejects.toThrow(/Refusing to overwrite/);
    await exportClientContractCommand(apiFile, { output: contract, force: true });
    await exportClientContractCommand(apiFile, { output: contract, check: true });
    expect(process.exitCode).toBe(0);
  });

  it('writes only the canonical contract with --stdout', async () => {
    const write = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    await exportClientContractCommand(apiFile, { stdout: true });
    const { api } = await import('../../type-tests/fixtures/serve-client-api.js');
    expect(write).toHaveBeenCalledWith(api.clientContract().canonical);
    await expect(exportClientContractCommand(apiFile, { stdout: true, check: true })).rejects.toThrow(/--stdout/);
  });

  it('prints the contract as the one --json result with --stdout', async () => {
    const out: string[] = [];
    enableJsonOutput(text => out.push(text));
    try {
      await exportClientContractCommand(apiFile, { stdout: true });
      emitDefaultResult(); // What the CLI wrapper does after every command.
    } finally {
      disableJsonOutput();
    }
    const { api } = await import('../../type-tests/fixtures/serve-client-api.js');
    expect(out).toHaveLength(1);
    expect(out[0].trimEnd()).toBe(api.clientContract().canonical.trimEnd());
    expect(() => JSON.parse(out[0])).not.toThrow();
  });

  it('keeps the API module\'s startup logs off stdout', async () => {
    const root = await directory();
    const noisy = path.join(root, 'noisy-api.mjs');
    const { api } = await import('../../type-tests/fixtures/serve-client-api.js');
    const prepared = api.clientContract();
    await writeFile(noisy, `console.log('PRIVATE startup log');\nexport const api = { handler: async () => ({}), clientContract: () => (${JSON.stringify(prepared)}) };\n`);
    const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const stderr = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    await exportClientContractCommand(noisy, { stdout: true });
    expect(stdout.mock.calls).toEqual([[prepared.canonical]]);
    expect(stderr).toHaveBeenCalledWith('PRIVATE startup log');
    expect(console.log).not.toBe(console.error);
  });

  it('refuses an API without clientContract() and a contract whose identities were edited', async () => {
    const root = await directory();
    const legacy = path.join(root, 'legacy-api.mjs');
    await writeFile(legacy, 'export const api = { handler: async () => ({}), manifest: () => ({}) };\n');
    await expect(exportClientContractCommand(legacy, { stdout: true })).rejects.toThrow(/clientContract\(\) method/);
    const empty = path.join(root, 'empty-api.mjs');
    const { contract: { kind, version, view } } = (await import('../../type-tests/fixtures/serve-client-api.js')).api.clientContract();
    const { prepareProtocolClientContract } = await import('@hypequery/protocol');
    const emptyContract = JSON.stringify(prepareProtocolClientContract({ kind, version, view, endpoints: [] }));
    await writeFile(empty, `export const api = { handler: async () => ({}), clientContract: () => (${emptyContract}) };\n`);
    await expect(exportClientContractCommand(empty, { stdout: true })).rejects.toThrow(/no endpoints/);
    const { api } = await import('../../type-tests/fixtures/serve-client-api.js');
    const prepared = api.clientContract();
    expect(() => canonicalClientContract({ ...prepared, contentHash: '0'.repeat(64) })).toThrow(/identities do not match/);
  });
});
