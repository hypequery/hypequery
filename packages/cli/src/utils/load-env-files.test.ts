import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { envFileVariableNames, recordShellEnvironment, resetShellEnvironment } from './env-provenance.js';
import { applyEnvFileVariables, loadEnvFiles } from './load-env-files.js';

const NAMES = [
  'HYPEQUERY_CLOUD_URL',
  'DOTENV_CONFIG_OVERRIDE',
  'DOTENV_OVERRIDE',
  'HQ_TEST_FROM_LOCAL',
  'HQ_TEST_FROM_ENV',
] as const;

describe('loadEnvFiles', () => {
  const saved = Object.fromEntries(NAMES.map(name => [name, process.env[name]]));
  const directories: string[] = [];

  afterEach(async () => {
    for (const name of NAMES) {
      if (saved[name] === undefined) delete process.env[name];
      else process.env[name] = saved[name];
    }
    resetShellEnvironment();
    await Promise.all(directories.splice(0).map(directory => rm(directory, { recursive: true, force: true })));
  });

  async function project(files: Record<string, string>) {
    const directory = await mkdtemp(path.join(tmpdir(), 'hypequery-env-files-'));
    directories.push(directory);
    for (const [name, contents] of Object.entries(files)) await writeFile(path.join(directory, name), contents);
    return directory;
  }

  it('does not let an env file turn on dotenv override and replace a shell value', async () => {
    for (const name of NAMES) delete process.env[name];
    process.env.HYPEQUERY_CLOUD_URL = 'https://cloud.hypequery.com';
    recordShellEnvironment();
    const directory = await project({
      '.env.local': 'DOTENV_CONFIG_OVERRIDE=true\nDOTENV_OVERRIDE=true\nHQ_TEST_FROM_LOCAL=local\n',
      '.env': 'HYPEQUERY_CLOUD_URL=https://evil.example\nHQ_TEST_FROM_ENV=env\n',
    });

    await loadEnvFiles(directory);

    expect(process.env.HYPEQUERY_CLOUD_URL).toBe('https://cloud.hypequery.com');
    expect(process.env.HQ_TEST_FROM_LOCAL).toBe('local');
    expect(process.env.HQ_TEST_FROM_ENV).toBe('env');
    expect(envFileVariableNames().has('HYPEQUERY_CLOUD_URL')).toBe(false);
    expect(envFileVariableNames().has('HQ_TEST_FROM_ENV')).toBe(true);
  });

  it('lets an earlier file in the cascade win over a later one', async () => {
    for (const name of NAMES) delete process.env[name];
    const directory = await project({
      '.env.local': 'HYPEQUERY_CLOUD_URL=https://local.example.test\n',
      '.env': 'HYPEQUERY_CLOUD_URL=https://env.example.test\n',
    });

    await loadEnvFiles(directory);

    expect(process.env.HYPEQUERY_CLOUD_URL).toBe('https://local.example.test');
  });

  it('never overwrites a set variable, even an empty one', () => {
    const env: NodeJS.ProcessEnv = { A: '', B: 'shell' };
    applyEnvFileVariables(env, [{ A: 'file', C: 'first' }, { B: 'file', C: 'second' }]);
    expect(env).toEqual({ A: '', B: 'shell', C: 'first' });
  });
});
