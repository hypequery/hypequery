import schema from './schema.json';

type Field = { kind: string; optional?: boolean; values?: readonly unknown[]; format?: string; fields?: Record<string, Field> };
type Definition = { properties: Record<string, Field>; variants?: Record<string, Record<string, Field>> };
export type WireEvent = { event: string; distinct_id: string; properties: Record<string, unknown>; timestamp: string };

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function fieldsValid(fields: Record<string, Field>, value: unknown): boolean {
  return record(value)
    && Object.keys(value).every(key => Object.hasOwn(fields, key) && fieldValid(fields[key], value[key]))
    && Object.entries(fields).every(([key, field]) => field.optional || Object.hasOwn(value, key));
}

function fieldValid(field: Field, value: unknown): boolean {
  switch (field.kind) {
    case 'boolean': return typeof value === 'boolean';
    case 'enum': return field.values!.includes(value);
    case 'enum_list': return Array.isArray(value) && value.length <= field.values!.length
      && new Set(value).size === value.length && value.every(item => field.values!.includes(item));
    case 'record': return fieldsValid(field.fields!, value);
    case 'format': {
      const rule = schema.VALUE_FORMATS[field.format as keyof typeof schema.VALUE_FORMATS];
      return typeof value === 'string' && value.length <= rule.maxLength
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
    if (!record(item) || Object.keys(item).length !== 4 || typeof item.event !== 'string'
      || !Object.hasOwn(schema.EVENT_CATALOG, item.event) || !record(item.properties)
      || typeof item.timestamp !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(item.timestamp)
      || !Number.isFinite(Date.parse(item.timestamp)) || new Date(item.timestamp).toISOString() !== item.timestamp) return false;
    const { $process_person_profile, $geoip_disable, ...properties } = item.properties;
    if ($process_person_profile !== false || $geoip_disable !== true || item.distinct_id !== properties.install_id) return false;
    const definition = (schema.EVENT_CATALOG as Record<string, Definition>)[item.event];
    let variant = {};
    if (definition.variants) {
      if (typeof properties.command !== 'string' || !Object.hasOwn(definition.variants, properties.command)) return false;
      variant = definition.variants[properties.command];
    }
    if (!fieldsValid({ ...schema.COMMON_PROPERTIES, ...definition.properties, ...variant }, properties)) return false;
    if (item.event === 'cli_command_completed') {
      const allowed = [...(schema.COMMAND_FLAGS as Record<string, string[]>)[properties.command as string], ...schema.GLOBAL_FLAGS];
      if (!(properties.flags_used as string[]).every(flag => allowed.includes(flag))) return false;
    }
    return true;
  });
}
