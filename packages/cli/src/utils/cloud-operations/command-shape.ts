import { isSecretInput, SECRET_OUTPUT_OPERATIONS } from './secrets.js';
import type { CloudOperationSpec, JsonSchema } from './spec-types.js';

/**
 * How one Cloud operation becomes `hypequery <group> <action>`: the command's
 * name, its positional arguments (the path parameters after the project) and
 * one option per remaining input field. Everything here is derived from the
 * operation's spec, so a new operation gets a command without hand-written code.
 */

/** How a field's text on the command line becomes its JSON value. */
export type FieldKind = 'string' | 'integer' | 'number' | 'boolean' | 'list' | 'json';

/**
 * - `project`: `--project <slug>`, defaulting to the signed-in project.
 * - `argument`: a positional argument (a path parameter, e.g. `<version>`).
 * - `option`: `--<field> <value>` (booleans: `--<field>` / `--no-<field>`).
 * - `secret`: `--<field>-stdin`, a hidden prompt, or `--input-json`; never a flag value.
 * - `confirm`: the operation's own `confirm` field, set by `--yes`.
 */
export type FieldPlacement = 'project' | 'argument' | 'option' | 'secret' | 'confirm';

export interface CloudCommandField {
  /** The input property, e.g. `expectedRevision`. */
  readonly property: string;
  readonly kind: FieldKind;
  readonly required: boolean;
  /** The literal `null` on the command line sends JSON null. */
  readonly nullable: boolean;
  /** Allowed values (for a list, of each item). */
  readonly choices?: readonly string[];
  readonly description?: string;
  readonly placement: FieldPlacement;
  /** As written on the command line: `--expected-revision`, `<version>`, `--password-stdin`. */
  readonly flag: string;
  /** Commander's attribute name for the option (or the argument's name). */
  readonly key: string;
}

/** `required`: destructive, needs `--yes`. `optional`: Cloud asks only in some cases (`tenants.update`). */
export type ConfirmationMode = 'required' | 'optional' | 'none';

export interface CloudCommandShape {
  readonly operation: CloudOperationSpec;
  readonly group: string;
  readonly action: string;
  readonly fields: readonly CloudCommandField[];
  readonly confirmation: ConfirmationMode;
  /** Cloud returns a secret once; it goes to stdout only, with a warning on stderr. */
  readonly secretOutput: boolean;
}

/** Option keys every operation command already uses; no input field may take them. */
export const RESERVED_OPTION_KEYS: ReadonlySet<string> = new Set([
  'yes', 'inputJson', 'help', 'json', 'input', 'telemetry', 'version',
]);

/** `permissionSets` → `permission-sets`, `runStatus` → `run-status`. */
export function kebabCase(name: string): string {
  return name.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase();
}

/** Commander's attribute name for a long flag: `--expected-revision` → `expectedRevision`. */
function camelCase(kebab: string): string {
  return kebab.replace(/-([a-z0-9])/g, (_, letter: string) => letter.toUpperCase());
}

/** `releases.rollback` → `['releases', 'rollback']`; `deployKeys.create` → `['deploy-keys', 'create']`. */
export function commandPath(operationName: string): readonly [group: string, action: string] {
  const [resource, verb] = operationName.split('.');
  if (!resource || !verb) throw new Error(`Operation name "${operationName}" is not resource.verb.`);
  return [kebabCase(resource), kebabCase(verb)];
}

export function pathParameters(path: string): readonly string[] {
  return [...path.matchAll(/\{([A-Za-z][A-Za-z0-9]*)\}/g)].map(match => match[1]!);
}

function types(schema: JsonSchema): readonly string[] {
  if (Array.isArray(schema.type)) return schema.type as readonly string[];
  return typeof schema.type === 'string' ? [schema.type] : [];
}

function stringChoices(schema: JsonSchema | undefined): readonly string[] | undefined {
  if (!schema?.enum || !schema.enum.every(value => typeof value === 'string')) return undefined;
  return schema.enum as readonly string[];
}

/** A schema's kind once `null` is set aside: `{ anyOf: [X, { type: 'null' }] }` is X, nullable. */
function analyse(schema: JsonSchema): { kind: FieldKind; nullable: boolean; choices?: readonly string[] } {
  const alternatives = schema.anyOf ?? schema.oneOf;
  if (alternatives) {
    const nonNull = alternatives.filter(alternative => !(types(alternative).length === 1 && types(alternative)[0] === 'null'));
    const nullable = nonNull.length < alternatives.length;
    if (nonNull.length === 1) return { ...analyse(nonNull[0]!), nullable: nullable || analyse(nonNull[0]!).nullable };
    return { kind: 'json', nullable };
  }
  const declared = types(schema);
  const nullable = declared.includes('null');
  const kinds = declared.filter(type => type !== 'null');
  if (kinds.length !== 1) return { kind: 'json', nullable };
  const choices = stringChoices(schema);
  switch (kinds[0]) {
    case 'string': return { kind: 'string', nullable, ...(choices ? { choices } : {}) };
    case 'integer': return { kind: 'integer', nullable };
    case 'number': return { kind: 'number', nullable };
    case 'boolean': return { kind: 'boolean', nullable };
    case 'array': {
      const items = schema.items;
      const itemTypes = items ? types(items) : [];
      if (itemTypes.length === 1 && itemTypes[0] === 'string') {
        const itemChoices = stringChoices(items);
        return { kind: 'list', nullable, ...(itemChoices ? { choices: itemChoices } : {}) };
      }
      return { kind: 'json', nullable };
    }
    default: return { kind: 'json', nullable };
  }
}

export function commandShape(operation: CloudOperationSpec): CloudCommandShape {
  const [group, action] = commandPath(operation.name);
  const properties = operation.input.properties ?? {};
  const required = new Set(operation.input.required ?? []);
  const pathParams = pathParameters(operation.path);
  const fields: CloudCommandField[] = [];

  // Positional arguments first, in path order; `project` is always `--project`.
  for (const name of pathParams) {
    if (name === 'project') continue;
    const schema = properties[name] ?? { type: 'string' };
    const argument = kebabCase(name);
    fields.push({
      property: name,
      ...analyse(schema),
      required: true,
      ...(schema.description ? { description: schema.description } : {}),
      placement: 'argument',
      flag: `<${argument}>`,
      key: name,
    });
  }

  for (const [name, schema] of Object.entries(properties)) {
    if (pathParams.includes(name) && name !== 'project') continue;
    const analysed = analyse(schema);
    const base = {
      property: name,
      ...analysed,
      required: required.has(name),
      ...(schema.description ? { description: schema.description } : {}),
    };
    if (name === 'project') {
      fields.push({ ...base, placement: 'project', flag: '--project', key: 'project' });
    } else if (name === 'confirm' && analysed.kind === 'boolean') {
      fields.push({ ...base, placement: 'confirm', flag: '--yes', key: 'yes' });
    } else if (isSecretInput(operation.name, name)) {
      const flag = `--${kebabCase(name)}-stdin`;
      fields.push({ ...base, placement: 'secret', flag, key: camelCase(flag.slice(2)) });
    } else {
      const flag = `--${kebabCase(name)}`;
      fields.push({ ...base, placement: 'option', flag, key: camelCase(flag.slice(2)) });
    }
  }

  const confirmation: ConfirmationMode = operation.destructive
    ? 'required'
    : fields.some(field => field.placement === 'confirm') ? 'optional' : 'none';
  return {
    operation,
    group,
    action,
    fields,
    confirmation,
    secretOutput: SECRET_OUTPUT_OPERATIONS.has(operation.name),
  };
}
