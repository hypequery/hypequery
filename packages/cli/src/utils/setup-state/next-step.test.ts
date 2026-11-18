import { describe, expect, it } from 'vitest';
import type { SetupState } from './collect.js';
import { doctorChecks } from './doctor-checks.js';
import { chooseNextStep, renderNextStep } from './next-step.js';

/** A fully set-up project; each test breaks one thing. */
function ready(): SetupState {
  return {
    node: { version: '24.22.3', minimum: '22.12.0', supported: true },
    cli: { version: '1.32.0', inProject: true },
    cloud: { signedIn: false, source: null, expiresAt: null, unreadable: false },
    connection: {
      configured: true, url: 'https://ch.example.test:8443', database: 'analytics', username: 'reader',
      passwordSet: true, fromEnvFile: true, reachable: true, error: null, readOnly: true,
    },
    envFile: { exists: true, gitIgnored: true, worldReadable: false },
    project: { directory: '/project', packageJson: true, apiFile: '/project/analytics/api.ts', datasetsFile: '/project/analytics/datasets.ts', mcpPackage: true },
    agents: [{
      client: 'claude-code',
      error: null,
      servers: [{ name: 'hypequery', scope: 'project', file: '/home/.claude.json', kind: 'local', managed: true, missingExecutables: [], projectDirectory: '/project' }],
    }],
    skills: { user: 'current', project: 'missing' },
  };
}

function withState(change: (state: SetupState) => SetupState) {
  return change(ready());
}

describe('hypequery next', () => {
  it.each([
    ['upgrade-node', withState(state => ({ ...state, node: { ...state.node, version: '22.11.0', supported: false } }))],
    ['install-cli', withState(state => ({ ...state, cli: { ...state.cli, inProject: false } }))],
    ['connect', withState(state => ({ ...state, connection: { ...state.connection, configured: false, reachable: null } }))],
    ['fix-connection', withState(state => ({ ...state, connection: { ...state.connection, reachable: false, error: 'Authentication failed' } }))],
    ['model', withState(state => ({ ...state, project: { ...state.project, datasetsFile: null, apiFile: null } }))],
    ['serve', withState(state => ({ ...state, project: { ...state.project, apiFile: null } }))],
    ['connect-agent', withState(state => ({ ...state, agents: [{ client: 'cursor', error: null, servers: [] }] }))],
    ['skills', withState(state => ({ ...state, skills: { user: 'missing', project: 'missing' } }))],
    ['ask', ready()],
  ])('is %s when that is the first thing missing', (step, state) => {
    expect(chooseNextStep(state).step).toBe(step);
  });

  it('never asks the agent to collect the database password', () => {
    const next = chooseNextStep(withState(state => ({ ...state, connection: { ...state.connection, configured: false } })));
    const text = renderNextStep(next);
    expect(text).toContain('Never ask for the password in the chat');
    expect(next.commands.join(' ')).not.toMatch(/PASSWORD=/);
  });

  it('asks for confirmation before writing datasets', () => {
    const next = chooseNextStep(withState(state => ({ ...state, project: { ...state.project, datasetsFile: null } })));
    expect(next.instructions.join('\n')).toContain('Write datasets only after they say yes');
    expect(next.progress).toContain('- Datasets: due now');
    expect(next.progress).toContain('- ClickHouse connection: done');
  });

  it('counts the hosted connector as connecting the agent', () => {
    const state = withState(current => ({
      ...current,
      agents: [{ client: 'claude-code', error: null, servers: [{ name: 'hypequery-cloud', scope: 'user', file: '/home/.claude.json', kind: 'hosted', managed: true, missingExecutables: [], projectDirectory: null }] }],
    }));
    expect(chooseNextStep(state).step).toBe('ask');
  });
});

describe('hypequery doctor checks', () => {
  const byId = (state: SetupState) => Object.fromEntries(doctorChecks(state).map(check => [check.id, check]));

  it('passes a complete setup', () => {
    expect(doctorChecks(ready()).filter(check => check.status === 'fail')).toEqual([]);
  });

  it('fails a .env that git would commit, and warns when other users can read it', () => {
    const checks = byId(withState(state => ({ ...state, envFile: { exists: true, gitIgnored: false, worldReadable: true } })));
    expect(checks['env-ignored']).toMatchObject({ status: 'fail', fix: 'Add `.env` to .gitignore.' });
    expect(checks['env-permissions']).toMatchObject({ status: 'warn', fix: 'chmod 600 .env' });
  });

  it('warns when the ClickHouse user can write', () => {
    expect(byId(withState(state => ({ ...state, connection: { ...state.connection, readOnly: false } })))['read-only'].status).toBe('warn');
  });

  it('fails an MCP entry whose Node or CLI was removed, naming the reinstall', () => {
    const checks = byId(withState(state => ({
      ...state,
      agents: [{ client: 'claude-code', error: null, servers: [{ ...ready().agents[0].servers[0], missingExecutables: ['/old/node'] }] }],
    })));
    expect(checks['mcp:claude-code:hypequery']).toMatchObject({ status: 'fail', fix: 'hypequery mcp:install --agent claude-code' });
  });

  it('never reports the password itself', () => {
    expect(JSON.stringify(doctorChecks(withState(state => ({ ...state, connection: { ...state.connection, passwordSet: false } })))))
      .toContain('CLICKHOUSE_PASSWORD is empty');
  });
});
