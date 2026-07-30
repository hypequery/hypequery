import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { captureDeploymentSourceSnapshot } from './deployment-source-snapshot.js';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(temporaryDirectories.splice(0).map(directory => (
    rm(directory, { force: true, recursive: true })
  )));
});

describe('deployment source snapshots', () => {
  it('captures the project-local transitive source graph', async () => {
    const project = await mkdtemp(path.join(tmpdir(), 'hypequery-source-snapshot-test-'));
    temporaryDirectories.push(project);
    await mkdir(path.join(project, 'analytics/datasets'), { recursive: true });
    await writeFile(
      path.join(project, 'analytics/api.ts'),
      'export { Orders } from "./datasets/orders.js";\n',
    );
    await writeFile(
      path.join(project, 'analytics/datasets/orders.ts'),
      'export const Orders = { source: "analytics.orders" };\n',
    );
    vi.spyOn(process, 'cwd').mockReturnValue(project);

    const snapshot = await captureDeploymentSourceSnapshot('analytics/api.ts');

    expect(snapshot.entrypoint).toBe('analytics/api.ts');
    expect(snapshot.files.map(file => file.path)).toEqual([
      'analytics/api.ts',
      'analytics/datasets/orders.ts',
    ]);
    expect(new TextDecoder().decode(snapshot.files[1]?.bytes)).toContain('analytics.orders');
    expect(snapshot.revision).toBeUndefined();
  });
});
