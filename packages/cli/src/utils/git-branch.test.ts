import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { currentGitBranch } from './git-branch.js';

function git(cwd: string, ...args: string[]) {
  execFileSync('git', args, {
    cwd,
    stdio: 'ignore',
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: 'hypequery',
      GIT_AUTHOR_EMAIL: 'cli@hypequery.test',
      GIT_COMMITTER_NAME: 'hypequery',
      GIT_COMMITTER_EMAIL: 'cli@hypequery.test',
    },
  });
}

describe('currentGitBranch', () => {
  let root: string;
  let repo: string;
  let plain: string;

  beforeAll(() => {
    root = mkdtempSync(join(tmpdir(), 'hypequery-git-branch-'));
    repo = join(root, 'repo');
    plain = join(root, 'plain');
    mkdirSync(repo, { recursive: true });
    mkdirSync(plain, { recursive: true });
    git(repo, 'init', '--initial-branch=main', '.');
    git(repo, 'commit', '--allow-empty', '-m', 'initial');
  });

  afterAll(() => {
    rmSync(root, { force: true, recursive: true });
  });

  it('returns the checked-out branch name', async () => {
    await expect(currentGitBranch(repo)).resolves.toBe('main');
  });

  it('returns branch names containing slashes verbatim', async () => {
    git(repo, 'checkout', '-b', 'feature/customer-retention');
    try {
      await expect(currentGitBranch(repo)).resolves.toBe(
        'feature/customer-retention',
      );
    } finally {
      git(repo, 'checkout', 'main');
    }
  });

  it('returns null on a detached HEAD', async () => {
    git(repo, 'checkout', '--detach');
    try {
      await expect(currentGitBranch(repo)).resolves.toBeNull();
    } finally {
      git(repo, 'checkout', 'main');
    }
  });

  it('returns null outside a Git repository', async () => {
    await expect(currentGitBranch(plain)).resolves.toBeNull();
  });

  it('returns null when the working directory does not exist', async () => {
    await expect(currentGitBranch(join(root, 'missing'))).resolves.toBeNull();
  });
});
