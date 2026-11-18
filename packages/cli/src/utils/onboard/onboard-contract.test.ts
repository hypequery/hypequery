import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { loadOnboardContract } from './onboard-contract.js';

const CONTRACT_3_FIXTURE = new URL('../../../../../specs/datasets/contract-3-authoring-v1.json', import.meta.url);
const CONTRACT_2_FIXTURE = new URL('../../../../../specs/datasets/common-authoring-v1.json', import.meta.url);

describe('loadOnboardContract (deployment JSON)', () => {
  let dir: string | undefined;
  afterEach(async () => {
    if (dir) await rm(dir, { recursive: true, force: true });
    dir = undefined;
  });

  async function writeJson(source: URL): Promise<string> {
    dir = await mkdtemp(path.join(tmpdir(), 'hq-onboard-'));
    const file = path.join(dir, 'deployment.json');
    await writeFile(file, await readFile(source, 'utf8'));
    return file;
  }

  it('reads a contract 2 deployment JSON file', async () => {
    const loaded = await loadOnboardContract(await writeJson(CONTRACT_2_FIXTURE));
    expect(loaded.kind).toBe('contract');
    expect(loaded.contract.version).toBe(2);
  });

  it('refuses a valid contract 3 deployment JSON file by name', async () => {
    await expect(loadOnboardContract(await writeJson(CONTRACT_3_FIXTURE)))
      .rejects.toThrow(/onboard check reads deployment contract 2; this deployment uses contract 3 features/);
  });
});
