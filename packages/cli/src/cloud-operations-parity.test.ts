import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { Command } from 'commander';
import { OPERATIONS } from '@hypequery/cloud-client';
import { describe, expect, it } from 'vitest';
import { program } from './cli.js';
import { cloudOperationOf } from './commands/cloud-operations.js';
import { commandPath, RESERVED_OPTION_KEYS } from './utils/cloud-operations/command-shape.js';
import { CLI_EXEMPT_OPERATIONS } from './utils/cloud-operations/exemptions.js';
import {
  CONNECTOR_OFF_WITHOUT_SECRET_OUTPUT,
  NOT_SECRET_INPUT_FIELDS,
  SECRET_INPUT_FIELDS,
  SECRET_LOOKING_INPUT,
  SECRET_OUTPUT_OPERATIONS,
} from './utils/cloud-operations/secrets.js';

/**
 * AG-09f: operation parity, CLI column. Cloud offers every operation in
 * operations-v1.json on `/v1` and the CLI; an operation's `surfaces` only
 * narrows the connector (`connector: false` keeps secrets away from models).
 * So every operation in the spec must have a `hypequery <group> <action>`
 * command, or an entry in CLI_EXEMPT_OPERATIONS with a reason.
 */

interface SpecOperation {
  readonly name: string;
  readonly destructive: boolean;
  readonly connector?: boolean;
  readonly http: { readonly path: string };
  readonly input: { readonly properties?: Record<string, unknown> };
}

const specPath = fileURLToPath(new URL('../../../specs/cloud-api/operations-v1.json', import.meta.url));
const spec = JSON.parse(readFileSync(specPath, 'utf8')) as { operations: SpecOperation[] };

function operationCommands(): Map<string, Command> {
  const found = new Map<string, Command>();
  for (const group of program.commands) {
    for (const command of group.commands) {
      const shape = cloudOperationOf(command);
      if (shape) found.set(shape.operation.name, command);
    }
  }
  return found;
}

describe('Cloud operation parity: the CLI column', () => {
  it('keeps the generated operations table in step with operations-v1.json', () => {
    const script = fileURLToPath(new URL('../scripts/generate-cloud-operations.mjs', import.meta.url));
    expect(() => execFileSync(process.execPath, [script, '--check'], { stdio: 'pipe' })).not.toThrow();
  });

  it('is generated from the same spec as @hypequery/cloud-client', () => {
    expect(spec.operations.map(operation => operation.name).sort()).toEqual(Object.keys(OPERATIONS).sort());
  });

  it('gives every operation a command, or an exemption with a reason', () => {
    const commands = operationCommands();
    const missing = spec.operations
      .map(operation => operation.name)
      .filter(name => !commands.has(name) && !Object.hasOwn(CLI_EXEMPT_OPERATIONS, name));
    expect(missing, 'operations with no CLI command and no exemption').toEqual([]);

    const names = new Set(spec.operations.map(operation => operation.name));
    for (const [name, reason] of Object.entries(CLI_EXEMPT_OPERATIONS)) {
      expect(names.has(name), `exemption for unknown operation ${name}`).toBe(true);
      expect(reason.trim(), `exemption for ${name} needs a reason`).not.toBe('');
      expect(commands.has(name), `${name} is exempt but has a command`).toBe(false);
    }
    // Nothing else registers an operation command.
    expect([...commands.keys()].every(name => names.has(name))).toBe(true);
  });

  it('names each command after its operation, with no collisions', () => {
    const topLevel = program.commands.map(command => command.name());
    expect(new Set(topLevel).size).toBe(topLevel.length);
    for (const [name, command] of operationCommands()) {
      expect(`${command.parent?.name()} ${command.name()}`).toBe(commandPath(name).join(' '));
      const actions = command.parent!.commands.map(sibling => sibling.name());
      expect(new Set(actions).size).toBe(actions.length);
    }
  });

  it('offers every input field as an argument or an option, and --yes on destructive operations', () => {
    for (const [name, command] of operationCommands()) {
      const operation = spec.operations.find(candidate => candidate.name === name)!;
      const shape = cloudOperationOf(command)!;
      const longs = new Set(command.options.map(option => option.long));
      const argumentNames = command.registeredArguments.map(argument => argument.name());
      for (const property of Object.keys(operation.input.properties ?? {})) {
        const field = shape.fields.find(candidate => candidate.property === property);
        expect(field, `${name}.${property} has no field`).toBeDefined();
        if (field!.placement === 'argument') expect(argumentNames).toContain(field!.flag.slice(1, -1));
        else expect(longs.has(field!.flag), `${name}: ${field!.flag}`).toBe(true);
        expect(RESERVED_OPTION_KEYS.has(field!.key) && field!.placement === 'option', `${name}.${property} collides`).toBe(false);
      }
      expect(longs.has('--input-json')).toBe(true);
      if (operation.destructive) expect(longs.has('--yes'), `${name} needs --yes`).toBe(true);
    }
  });

  it('classifies every connector-off operation and every secret-looking input', () => {
    const byName = new Map(spec.operations.map(operation => [operation.name, operation]));
    for (const operation of spec.operations.filter(candidate => candidate.connector === false)) {
      const classified = SECRET_OUTPUT_OPERATIONS.has(operation.name)
        || Object.hasOwn(CONNECTOR_OFF_WITHOUT_SECRET_OUTPUT, operation.name);
      expect(classified, `${operation.name} is off the connector: list it in secrets.ts`).toBe(true);
    }
    for (const name of SECRET_OUTPUT_OPERATIONS) {
      expect(byName.get(name)?.connector, `${name} returns a secret, so Cloud keeps it off the connector`).toBe(false);
    }
    for (const operation of spec.operations) {
      for (const property of Object.keys(operation.input.properties ?? {})) {
        if (!SECRET_LOOKING_INPUT.test(property)) continue;
        const classified = SECRET_INPUT_FIELDS[operation.name]?.includes(property)
          || Object.hasOwn(NOT_SECRET_INPUT_FIELDS, `${operation.name}.${property}`);
        expect(classified, `${operation.name}.${property} looks like a secret: classify it in secrets.ts`).toBe(true);
      }
    }
    for (const [name, fields] of Object.entries(SECRET_INPUT_FIELDS)) {
      for (const field of fields) {
        expect(Object.keys(byName.get(name)?.input.properties ?? {})).toContain(field);
      }
    }
  });
});
