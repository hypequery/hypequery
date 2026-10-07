import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { COMMON_PROPERTIES, COMMAND_PROPERTIES, EVENT_CATALOG, SESSION_END_PROPERTIES, SESSION_START_PROPERTIES } from './catalog.js';
import { renderTelemetryCatalog } from './catalog-docs.js';
import { COMMAND_FLAGS, GLOBAL_FLAGS } from './domains.js';
import { flagNames, knownCommand } from './flags.js';
import { createTelemetryEvent, validateTelemetryEvent } from './validation.js';
import { common, completed } from '../../../type-tests/fixtures.js';
import type { Field, Fields } from './schema.js';
import { VALUE_FORMATS } from './value-formats.js';

function sampleField(field: Field): unknown {
  switch (field.kind) {
    case 'boolean': return false;
    case 'enum': return field.values[0];
    case 'enum_list': return [];
    case 'record': return sampleProperties(field.fields);
    case 'format': return {
      uuid: common.install_id, hash: 'a'.repeat(64), version: '1.0.0',
      node_version: '22.10', major_version: '10',
    }[field.format];
  }
}
function sampleProperties(fields: Fields): Record<string, unknown> {
  return Object.fromEntries(Object.entries(fields).map(([key, field]) => [key, sampleField(field)]));
}

describe('telemetry event contract', () => {
  it('snapshots the complete versioned catalog', () => {
    expect({ formats: VALUE_FORMATS, common: COMMON_PROPERTIES, events: EVENT_CATALOG }).toMatchSnapshot();
  });

  it('keeps the generated public event reference synchronized', async () => {
    const page = await readFile(fileURLToPath(new URL('../../../../../website-next/docs/telemetry.mdx', import.meta.url)), 'utf8');
    expect(page.split('{/* telemetry-catalog */}\n\n')[1]).toBe(renderTelemetryCatalog());
  });

  it('validates every event variant, including all optional fields and nested records', () => {
    for (const [event, definition] of Object.entries(EVENT_CATALOG)) {
      const variants: Record<string, Fields> = 'variants' in definition ? definition.variants : { none: {} };
      for (const [command, variant] of Object.entries(variants)) {
        const properties = { ...sampleProperties(COMMON_PROPERTIES), ...sampleProperties(definition.properties), ...sampleProperties(variant) };
        if ('variants' in definition) properties.command = command;
        expect(validateTelemetryEvent({ event, properties }), `${event}/${command}`).toBe(true);
        expect(validateTelemetryEvent({ event, properties: { ...properties, raw_message: 'private' } })).toBe(false);
      }
    }
  });

  it('builds detached valid payloads without retaining mutable input', () => {
    const input = structuredClone(completed);
    const payload = createTelemetryEvent(input);
    expect(payload).toEqual(input);
    expect(payload).not.toBe(input);
    expect(payload?.properties).not.toBe(input.properties);
  });

  it('rejects fields from other commands and arbitrary flag names', () => {
    expect(validateTelemetryEvent({ ...completed, properties: { ...completed.properties, command: 'generate' } })).toBe(false);
    expect(validateTelemetryEvent({ ...completed, properties: { ...completed.properties, flags_used: ['--tenant'] } })).toBe(false);
    expect(validateTelemetryEvent({ ...completed, properties: { ...completed.properties, flags_used: ['--style', '--style'] } })).toBe(false);
    expect(validateTelemetryEvent({ ...completed, properties: { ...completed.properties, flags_used: ['--style=private'] } })).toBe(false);
  });

  it('rejects missing fields, future schema versions, raw measures and malformed identities', () => {
    const bad = [
      { ...completed, properties: { ...completed.properties, schema_version: 2 } },
      { ...completed, properties: { ...completed.properties, duration_bucket: 1_234 } },
      { ...completed, properties: { ...completed.properties, table_count_bucket: 10 } },
      { ...completed, properties: { ...completed.properties, install_id: '/private/id' } },
      { ...completed, properties: { ...completed.properties, project_id: 'github.com/private/repo' } },
      { ...completed, properties: { ...completed.properties, cli_version: '1.0.0-user-secret' } },
      { ...completed, properties: { ...completed.properties, cli_version: '1.0.0\n' } },
      { ...completed, properties: { ...completed.properties, install_id: common.install_id + '\n' } },
      { ...completed, properties: { ...completed.properties, node_version: 'v22.10.0' } },
      { ...completed, properties: { ...completed.properties, package_manager_major: '10.1' } },
      { event: 'cli_crash', properties: {} },
      { ...completed, properties: { ...completed.properties, hypequery_packages: { '@hypequery/cli': 'file:/private/pkg' } } },
      { ...completed, properties: { ...completed.properties, hypequery_packages: { private_project: '1.0.0' } } },
    ];
    for (const input of bad) expect(validateTelemetryEvent(input)).toBe(false);
    const missing = { ...completed.properties } as Record<string, unknown>;
    delete missing.session_id;
    expect(validateTelemetryEvent({ ...completed, properties: missing })).toBe(false);
  });

  it('rejects prototypes, getters, symbols and custom array serialization', () => {
    const props = Object.create({ hidden: 'private' });
    Object.assign(props, completed.properties);
    expect(validateTelemetryEvent({ ...completed, properties: props })).toBe(false);
    let called = false;
    const getter = { ...completed.properties, get path() { called = true; return 'private'; } };
    expect(validateTelemetryEvent({ ...completed, properties: getter })).toBe(false);
    expect(called).toBe(false);
    expect(validateTelemetryEvent({ ...completed, [Symbol('private')]: 'private' })).toBe(false);
    const flags = Object.assign(['--style'], { toJSON: () => ['private'] });
    expect(validateTelemetryEvent({ ...completed, properties: { ...completed.properties, flags_used: flags } })).toBe(false);
    expect(validateTelemetryEvent(new Proxy({}, { getPrototypeOf() { throw new Error('private'); } }))).toBe(false);
    expect(validateTelemetryEvent(JSON.parse('{"event":"cli_command_completed","properties":{"__proto__":"private"}}'))).toBe(false);
  });

  it('fuzzes every declared field and nesting level with content sentinels', () => {
    const sentinels = ['/home/private/project', 'private_table_name', 'https://user:password@private.example', 'ENV_SECRET_7291', 'tenant_private_6829', 'SELECT secret FROM customer', 'Error: private failure'];
    for (const sentinel of sentinels) {
      for (const [event, definition] of Object.entries(EVENT_CATALOG)) {
        const variants: Record<string, Fields> = 'variants' in definition ? definition.variants : { none: {} };
        for (const [command, variant] of Object.entries(variants)) {
          const fields = { ...COMMON_PROPERTIES, ...definition.properties, ...variant };
          const valid = sampleProperties(fields);
          if ('variants' in definition) valid.command = command;
          for (const [key, field] of Object.entries(fields)) {
            expect(validateTelemetryEvent({ event, properties: { ...valid, [key]: sentinel } }), `${event}/${command}/${key}`).toBe(false);
            if (field.kind === 'enum_list') {
              expect(validateTelemetryEvent({ event, properties: { ...valid, [key]: [sentinel] } })).toBe(false);
            }
            if (field.kind === 'record') {
              for (const nested of Object.keys(field.fields)) {
                expect(validateTelemetryEvent({ event, properties: { ...valid, [key]: { ...sampleProperties(field.fields), [nested]: sentinel } } })).toBe(false);
              }
            }
          }
          const flags = flagNames(knownCommand(command), [sentinel, `--path=${sentinel}`, '--tables', sentinel, '--tenant', sentinel, '--unknown=' + sentinel]);
          expect(JSON.stringify(flags)).not.toContain(sentinel);
        }
      }
    }
  });

  it('normalizes known aliases and drops values, unknown flags and tokens after --', () => {
    expect(flagNames('generate', ['-o', '/private/output', '--tables=private', '--database', 'secret', '--unknown=secret', '--', '--path']))
      .toEqual(['--database', '--output', '--tables']);
    expect(knownCommand('private-command')).toBe('unknown');
    expect(flagNames('unknown', ['--tables', 'secret', '--no-telemetry'])).toEqual(['--no-telemetry']);
    expect(flagNames('generate', ['-h'])).toEqual(['--help']);
    expect(flagNames('dev', ['-h', 'private-host'])).toEqual(['--hostname']);
    expect(flagNames('dev', ['-qp4000', '-hprivate-host'])).toEqual(['--hostname', '--port', '--quiet']);
    expect(flagNames('generate', ['-oprivate-qV.ts'])).toEqual(['--output']);
    expect(flagNames('dev', ['-p4000'])).toEqual(['--port']);
  });

  it('covers all registered commands and their actual canonical flags', async () => {
    const { program } = await import('../../cli.js');
    expect(Object.keys(COMMAND_PROPERTIES)).toEqual(expect.arrayContaining(program.commands.map(command => command.name())));
    for (const command of program.commands) {
      const known = knownCommand(command.name());
      expect([...COMMAND_FLAGS[known]].sort()).toEqual(command.options.map(option => option.long).sort());
    }
    expect(GLOBAL_FLAGS).toContain('--no-telemetry');
    expect(Object.keys(SESSION_START_PROPERTIES)).toEqual(Object.keys(SESSION_END_PROPERTIES));
  });
});
