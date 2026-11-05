import schema from './schema.json';

type Field = { kind: string; optional?: boolean; values?: readonly unknown[]; format?: string; fields?: Record<string, Field> };
type Definition = { properties: Record<string, Field>; variants?: Record<string, Record<string, Field>> };
type Pattern = { source: string; flags: string };
type Contract = {
  COMMON_PROPERTIES: Record<string, Field>; EVENT_CATALOG: Record<string, Definition>;
  COMMAND_FLAGS: Record<string, string[]>; GLOBAL_FLAGS: readonly string[];
  VALUE_FORMATS: Record<string, { pattern: Pattern; maxLength: number }>;
};
/** The TypeScript CLI's contract, then the Python CLI's; event names never overlap. */
export const isPythonEvent = (event: string) => Object.hasOwn(schema.PYTHON.EVENT_CATALOG, event);
const CONTRACTS = [schema, schema.PYTHON] as unknown as Contract[];
export type WireEvent = { event: string; distinct_id: string; properties: Record<string, unknown>; timestamp: string };

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function fieldsValid(fields: Record<string, Field>, value: unknown, contract: Contract): boolean {
  return record(value)
    && Object.keys(value).every(key => Object.hasOwn(fields, key) && fieldValid(fields[key], value[key], contract))
    && Object.entries(fields).every(([key, field]) => field.optional || Object.hasOwn(value, key));
}

function fieldValid(field: Field, value: unknown, contract: Contract): boolean {
  switch (field.kind) {
    case 'boolean': return typeof value === 'boolean';
    case 'enum': return field.values!.includes(value);
    case 'enum_list': return Array.isArray(value) && value.length <= field.values!.length
      && new Set(value).size === value.length && value.every(item => field.values!.includes(item));
    case 'record': return fieldsValid(field.fields!, value, contract);
    case 'format': {
      const rule = contract.VALUE_FORMATS[field.format!];
      return !!rule && typeof value === 'string' && value.length <= rule.maxLength
        && new RegExp(rule.pattern.source, rule.pattern.flags).exec(value)?.[0] === value;
    }
    default: return false;
  }
}

/** Only call on parsed JSON. Unknown keys are rejected, including nested records. */
export function validateBatch(input: unknown): input is { api_key: string; batch: WireEvent[] } {
  if (!record(input) || Object.keys(input).length !== 2 || input.api_key !== 'hypequery-cli'
    || !Array.isArray(input.batch) || input.batch.length < 1 || input.batch.length > 32) return false;
  return input.batch.every(item => {
    if (!record(item) || typeof item.event !== 'string') return false;
    const event = item.event;
    const contract = CONTRACTS.find(entry => Object.hasOwn(entry.EVENT_CATALOG, event));
    if (Object.keys(item).length !== 4 || !contract || !record(item.properties)
      || typeof item.timestamp !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(item.timestamp)
      || !Number.isFinite(Date.parse(item.timestamp)) || new Date(item.timestamp).toISOString() !== item.timestamp) return false;
    const { $process_person_profile, $geoip_disable, ...properties } = item.properties;
    if ($process_person_profile !== false || $geoip_disable !== true || item.distinct_id !== properties.install_id) return false;
    const definition = contract.EVENT_CATALOG[event];
    let variant = {};
    if (definition.variants) {
      if (typeof properties.command !== 'string' || !Object.hasOwn(definition.variants, properties.command)) return false;
      variant = definition.variants[properties.command];
    }
    if (!fieldsValid({ ...contract.COMMON_PROPERTIES, ...definition.properties, ...variant }, properties, contract)) return false;
    if (Object.hasOwn(definition.properties, 'flags_used')) {
      const allowed = [...contract.COMMAND_FLAGS[properties.command as string], ...contract.GLOBAL_FLAGS];
      if (!(properties.flags_used as string[]).every(flag => allowed.includes(flag))) return false;
    }
    return true;
  });
}
