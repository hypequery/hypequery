import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { captureDeploymentSourceSnapshot } from './deployment-source-snapshot.js';

const temporaryDirectories: string[] = [];

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: 'hypequery',
      GIT_AUTHOR_EMAIL: 'cli@hypequery.test',
      GIT_COMMITTER_NAME: 'hypequery',
      GIT_COMMITTER_EMAIL: 'cli@hypequery.test',
    },
  }).trim();
}

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

  it('captures Git branch and commit provenance during deployment builds', async () => {
    const project = await mkdtemp(path.join(tmpdir(), 'hypequery-source-revision-test-'));
    temporaryDirectories.push(project);
    await mkdir(path.join(project, 'analytics'), { recursive: true });
    await writeFile(path.join(project, 'analytics/api.ts'), 'export const api = {}\n');
    git(project, 'init', '--initial-branch=main', '.');
    git(project, 'add', 'analytics/api.ts');
    git(project, 'commit', '-m', 'initial');
    git(project, 'checkout', '-b', 'feature/customer-retention');
    const commit = git(project, 'rev-parse', 'HEAD');
    vi.spyOn(process, 'cwd').mockReturnValue(project);

    const snapshot = await captureDeploymentSourceSnapshot('analytics/api.ts');

    expect(snapshot.revision).toEqual({
      kind: 'git',
      branch: 'feature/customer-retention',
      commit,
      dirty: false,
    });
  });
});
