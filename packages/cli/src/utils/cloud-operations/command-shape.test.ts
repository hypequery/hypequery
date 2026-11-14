import { describe, expect, it } from 'vitest';
import { CLOUD_OPERATION_SPECS } from '../../generated/cloud-operations.js';
import { commandPath, commandShape, kebabCase } from './command-shape.js';
import { parseFieldValue } from './operation-input.js';

function shapeOf(name: string) {
  const operation = CLOUD_OPERATION_SPECS.find(candidate => candidate.name === name);
  if (!operation) throw new Error(`no ${name} in the spec`);
  return commandShape(operation);
}

function field(name: string, property: string) {
  const found = shapeOf(name).fields.find(candidate => candidate.property === property);
  if (!found) throw new Error(`no ${name}.${property}`);
  return found;
}

describe('command names', () => {
  it('kebab-cases the resource and verb', () => {
    expect(kebabCase('permissionSets')).toBe('permission-sets');
    expect(commandPath('releases.rollback')).toEqual(['releases', 'rollback']);
    expect(commandPath('deployKeys.create')).toEqual(['deploy-keys', 'create']);
    expect(commandPath('drafts.runStatus')).toEqual(['drafts', 'run-status']);
    expect(commandPath('org.setAccessPolicy')).toEqual(['org', 'set-access-policy']);
  });
});

describe('fields from the input schema', () => {
  it('makes path parameters positional, in path order, and the project an option', () => {
    const shape = shapeOf('releases.rollback');
    expect(shape.fields.map(candidate => [candidate.property, candidate.placement, candidate.flag])).toEqual([
      ['version', 'argument', '<version>'],
      ['project', 'project', '--project'],
      ['expectedRevision', 'option', '--expected-revision'],
    ]);
    expect(shape.confirmation).toBe('required');
    expect(field('logs.get', 'requestId').flag).toBe('<request-id>');
  });

  it('reads kinds, choices and nullability', () => {
    expect(field('logs.query', 'range')).toMatchObject({ kind: 'string', choices: ['1h', '24h', '7d'], required: false });
    expect(field('logs.query', 'limit')).toMatchObject({ kind: 'integer' });
    expect(field('drafts.promote', 'expectedRevision')).toMatchObject({ kind: 'string', nullable: true, required: true });
    expect(field('customerLimits.set', 'requestsPerMinute')).toMatchObject({ kind: 'integer', nullable: true });
    expect(field('jwtIssuer.save', 'algorithms')).toMatchObject({ kind: 'list', choices: expect.arrayContaining(['RS256']) });
    expect(field('permissionSets.create', 'datasets')).toMatchObject({ kind: 'json' });
    expect(field('drafts.checks', 'rerun')).toMatchObject({ kind: 'boolean', flag: '--rerun' });
  });

  it('takes secrets from stdin, and maps an operation\'s own confirm field to --yes', () => {
    expect(field('connections.save', 'password')).toMatchObject({ placement: 'secret', flag: '--password-stdin', key: 'passwordStdin' });
    expect(field('tenants.update', 'confirm')).toMatchObject({ placement: 'confirm', flag: '--yes' });
    expect(shapeOf('tenants.update').confirmation).toBe('optional');
    expect(shapeOf('projects.list').confirmation).toBe('none');
  });

  it('marks the operations that return a secret once', () => {
    expect(shapeOf('apiKeys.create').secretOutput).toBe(true);
    expect(shapeOf('apiKeys.list').secretOutput).toBe(false);
  });
});

describe('parseFieldValue', () => {
  it('parses by kind and refuses what does not fit, naming the flag', () => {
    expect(parseFieldValue(field('logs.query', 'limit'), '10')).toBe(10);
    expect(() => parseFieldValue(field('logs.query', 'limit'), 'ten')).toThrow('--limit expects a whole number.');
    expect(() => parseFieldValue(field('logs.query', 'range'), '1y')).toThrow('--range must be one of: 1h, 24h, 7d.');
    expect(parseFieldValue(field('customerLimits.set', 'requestsPerMinute'), 'null')).toBeNull();
    expect(parseFieldValue(field('permissionSets.create', 'datasets'), '"*"')).toBe('*');
    expect(() => parseFieldValue(field('permissionSets.create', 'datasets'), '{')).toThrow('--datasets expects JSON.');
  });
});
