import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  PROJECT_CONFIG_FILENAME,
  readProjectConfig,
  writeProjectConfig,
} from './project-config.js';

describe('project config', () => {
  it('round-trips the persistent chDB session path', async () => {
    const workdir = await mkdtemp(path.join(tmpdir(), 'hq-project-config-'));
    const config = { database: 'chdb' as const, chdbPath: './analytics.chdb' };

    await writeProjectConfig(config, workdir);

    await expect(readProjectConfig(workdir)).resolves.toEqual(config);
  });

  it('returns an empty config when the file does not exist', async () => {
    const workdir = await mkdtemp(path.join(tmpdir(), 'hq-project-config-'));

    await expect(readProjectConfig(workdir)).resolves.toEqual({});
  });

  it('rejects malformed configuration instead of silently using an empty session', async () => {
    const workdir = await mkdtemp(path.join(tmpdir(), 'hq-project-config-'));
    await writeFile(path.join(workdir, PROJECT_CONFIG_FILENAME), '{not-json');

    await expect(readProjectConfig(workdir)).rejects.toThrow(/invalid JSON/);
  });
});
