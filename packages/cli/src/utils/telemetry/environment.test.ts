import { describe, expect, it } from 'vitest';
import { ciContext, CI_SIGNALS, collectEnvironment, installedPackages, packageManagerContext } from './environment.js';
import { validateTelemetryEvent } from './validation.js';
import { common } from '../../../type-tests/fixtures.js';

describe('telemetry environment', () => {
  it.each(CI_SIGNALS)('detects %s without recording its value', (key, name) => {
    expect(ciContext({ [key]: 'private-provider-value' })).toEqual({ is_ci: true, ci_name: name });
    expect(ciContext({ [key]: 'false' })).toEqual({ is_ci: false, ci_name: 'none' });
  });
  it('distinguishes generic CI and non-CI', () => {
    expect(ciContext({ CI: '1' })).toEqual({ is_ci: true, ci_name: 'unknown' });
    expect(ciContext({ CI: 'false' })).toEqual({ is_ci: false, ci_name: 'none' });
  });
  it.each([
    ['npm/10.2.0 node/v22', '/private/.npm/_npx/id/node_modules/.bin/hypequery', 'npx', 'npm'],
    ['pnpm/10.1.0', '/private/cache/pnpm/dlx/id/node_modules/.bin/hypequery', 'pnpm_dlx', 'pnpm'],
    ['bun/1.2.0', '/private/.bun/install/cache/bin/hypequery', 'bunx', 'bun'],
    ['yarn/4.2.0', '/private/node_modules/.bin/hypequery', 'local_bin', 'yarn'],
    ['npm/10.1.0', '/usr/local/lib/node_modules/@hypequery/cli/dist/bin/cli.js', 'global', 'npm'],
    ['private-secret', '/private/unknown', 'unknown', 'unknown'],
  ])('classifies %s at %s without retaining either', (agent, executable, invoked, manager) => {
    const result = packageManagerContext({ npm_config_user_agent: agent }, executable);
    expect(result.invoked_via).toBe(invoked);
    expect(result.package_manager).toBe(manager);
    expect(JSON.stringify(result)).not.toContain('private');
  });
  it('only reports allowlisted exact versions, preferring installed versions over ranges', () => {
    const context = { directory: '/private/project', package: { name: 'secret', dependencies: { '@hypequery/react': '^1.2.0', '@hypequery/cli': 'file:/private/secret', '@hypequery/serve': '1.2.3', private_dependency: 'secret' } } };
    const result = installedPackages(context, file => file.endsWith('/@hypequery/react/package.json') ? '{"version":"1.2.4"}' : undefined);
    expect(result).toEqual({ '@hypequery/react': '1.2.4', '@hypequery/cli': 'unknown', '@hypequery/serve': '1.2.3' });
    expect(JSON.stringify(result)).not.toMatch(/private|secret/);
  });
  it('produces a valid common context without network or content leakage', () => {
    const environment = collectEnvironment({}, {
      env: { CI: '1', CLICKHOUSE_URL: 'https://user:secret@private-host', WSL_DISTRO_NAME: 'private-distro' },
      read: file => file === '/.dockerenv' ? '' : undefined,
      cliVersion: '1.22.0', nodeVersion: '22.10.1', platform: 'linux', arch: 'x64', isTTY: false,
      executable: '/private/cli',
    });
    expect(environment).toMatchObject({ database: 'clickhouse', is_ci: true, is_docker: true, is_wsl: true, node_version: '22.10' });
    expect(JSON.stringify(environment)).not.toMatch(/secret|private/);
    expect(validateTelemetryEvent({ event: 'cli_crash', properties: { ...common, ...environment, command: 'unknown', exception_class: 'unknown', error_code: 'unknown' } })).toBe(true);
  });
  it('falls back safely when metadata is unavailable or malformed', () => {
    expect(collectEnvironment({}, { env: {}, read: () => { throw new Error('private'); }, cliVersion: 'private', nodeVersion: 'private', platform: 'private', arch: 'private' }))
      .toMatchObject({ cli_version: 'unknown', node_version: 'unknown', os: 'unknown', arch: 'unknown', database: 'unknown', is_docker: false });
    expect(collectEnvironment({ package: { dependencies: { chdb: '^1' } } }, { env: {}, read: () => undefined }).database).toBe('chdb');
  });
});
