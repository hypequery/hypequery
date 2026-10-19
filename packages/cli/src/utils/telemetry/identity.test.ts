import { describe, expect, it } from 'vitest';
import { normalizeProjectRemote, projectId, invocationIdentity } from './identity.js';
import { inspectProject, remoteFromGitConfig } from './project-context.js';

describe('project identity', () => {
  it('normalizes transport variants and strips credentials before hashing', () => {
    const remotes = ['git@github.com:Team/repo.git', 'ssh://git@github.com:22/Team/repo.git', 'https://user:secret@github.com/Team/repo.git?token=private#private', 'git://github.com:9418/Team/repo'];
    expect(new Set(remotes.map(normalizeProjectRemote))).toEqual(new Set(['github.com/Team/repo']));
    expect(new Set(remotes.map(remote => projectId({ remote })))).toHaveLength(1);
    expect(projectId({ remote: remotes[0] })).toMatch(/^[0-9a-f]{64}$/);
    expect(normalizeProjectRemote('ssh://git@example.com:2222/team/repo')).toBe('example.com:2222/team/repo');
  });
  it.each(['/home/private/repo', 'file:///private/repo', 'C:\\private\\repo', '../private', 'not a remote'])('omits local or invalid remotes: %s', input => {
    expect(normalizeProjectRemote(input)).toBeUndefined();
  });
  it('uses the workspace package name as fallback and never a path or user', () => {
    expect(projectId({ directory: '/private/path' })).toBeUndefined();
    const context = { package: { name: 'child' }, rootPackage: { name: 'private-workspace' } };
    expect(projectId(context)).toBe(projectId({ package: { name: 'private-workspace' } }));
    const config = { enabled: true, schema_version: 1, install_id: '643df3e7-070d-49d9-8048-852d59302146' } as const;
    const first = invocationIdentity(config, context);
    const second = invocationIdentity(config, context);
    expect(first.install_id).toBe(second.install_id);
    expect(first.project_id).toBe(second.project_id);
    expect(first.session_id).not.toBe(second.session_id);
    expect(JSON.stringify(first)).not.toMatch(/private|child|workspace/);
  });
  it('finds linked worktree common config and the workspace root without invoking git', () => {
    const files: Record<string, string> = {
      '/project/packages/app/package.json': '{"name":"private-child"}',
      '/project/package.json': '{"name":"private-root"}',
      '/project/pnpm-workspace.yaml': 'packages: [packages/*]',
      '/project/.git': 'gitdir: /git/worktrees/project\n',
      '/git/worktrees/project/commondir': '../..\n',
      '/git/config': '[remote "backup"]\nurl = https://example.com/backup\n[remote "origin"]\nurl = git@github.com:private/root.git\n',
    };
    const context = inspectProject('/project/packages/app', file => files[file], 100);
    expect(context.rootPackage?.name).toBe('private-root');
    expect(context.package?.name).toBe('private-child');
    expect(context.remote).toBe('git@github.com:private/root.git');
    expect(JSON.stringify(invocationIdentity({ enabled: true, schema_version: 1, install_id: '643df3e7-070d-49d9-8048-852d59302146' }, context))).not.toContain('private');
  });
  it('handles missing files, corrupt package JSON and no git', () => {
    expect(inspectProject('/missing', () => undefined, 100)).toEqual({});
    expect(inspectProject('/missing', () => { throw new Error('unreadable'); }, 100)).toEqual({});
    expect(remoteFromGitConfig('[core]\nurl = secret')).toBeUndefined();
    expect(remoteFromGitConfig('[remote "backup"]\nurl = "https://host/repo.git"')).toBe('https://host/repo.git');
  });
});
