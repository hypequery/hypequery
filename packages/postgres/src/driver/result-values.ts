/**
 * Text-format parsers that map Postgres values onto the hypequery result
 * contract the ClickHouse adapter produces, independent of any global
 * node-postgres type configuration. Unlisted types come back as their text.
 */

const BOOL = 16;
const INT8 = 20;
const INT2 = 21;
const INT4 = 23;
const OID = 26;
const JSON_OID = 114;
const FLOAT4 = 700;
const FLOAT8 = 701;
const NUMERIC = 1700;
const TIMESTAMPTZ = 1184;
const JSONB = 3802;

type TextParser = (value: string) => unknown;

const identity: TextParser = value => value;

const PARSERS: Readonly<Record<number, TextParser>> = {
  [BOOL]: value => value === 't',
  // Beyond 2^53 a number loses digits, so 64-bit integers stay strings,
  // as with the ClickHouse adapter's default quoted 64-bit encoding.
  [INT8]: identity,
  [INT2]: Number,
  [INT4]: Number,
  [OID]: Number,
  [FLOAT4]: parseFloatText,
  [FLOAT8]: parseFloatText,
  // AVG over integers and every ROUND produce numeric; ClickHouse returns
  // Float64 and unquoted Decimals as JSON numbers.
  [NUMERIC]: parseFloatText,
  [TIMESTAMPTZ]: utcWallClock,
  [JSON_OID]: value => JSON.parse(value),
  [JSONB]: value => JSON.parse(value),
};

function parseFloatText(value: string): number {
  switch (value) {
    case 'NaN': return Number.NaN;
    case 'Infinity': return Number.POSITIVE_INFINITY;
    case '-Infinity': return Number.NEGATIVE_INFINITY;
    default: return Number(value);
  }
}

/** The driver pins the session to UTC, so `timestamptz` text ends in `+00`. */
function utcWallClock(value: string): string {
  return value.endsWith('+00') ? value.slice(0, -3) : value;
}

/** Array OIDs and their element OIDs, for the element types results commonly carry. */
const ARRAY_ELEMENTS: Readonly<Record<number, number>> = {
  1000: BOOL, 1005: INT2, 1007: INT4, 1016: INT8, 1021: FLOAT4, 1022: FLOAT8, 1231: NUMERIC,
  1009: 25 /* text */, 1015: 1043 /* varchar */, 2951: 2950 /* uuid */, 1185: TIMESTAMPTZ,
  1115: 1114 /* timestamp */, 1182: 1082 /* date */,
};

/**
 * Parse a one-dimensional Postgres array literal (`{a,"b c",NULL}`) into its
 * elements, each through *element*. ClickHouse arrays arrive as JSON arrays;
 * anything multi-dimensional or malformed stays as its text.
 */
export function parseArrayLiteral(text: string, element: TextParser): unknown {
  if (!text.startsWith('{') || !text.endsWith('}')) return text;
  const body = text.slice(1, -1);
  if (body === '') return [];
  const items: unknown[] = [];
  let index = 0;
  while (index <= body.length) {
    let raw = '';
    let quoted = false;
    if (body[index] === '"') {
      quoted = true;
      index += 1;
      while (index < body.length && body[index] !== '"') {
        if (body[index] === '\\') index += 1;
        raw += body[index] ?? '';
        index += 1;
      }
      if (body[index] !== '"') return text;
      index += 1;
    } else {
      while (index < body.length && body[index] !== ',') {
        if (body[index] === '{') return text;
        raw += body[index];
        index += 1;
      }
    }
    items.push(!quoted && raw === 'NULL' ? null : element(raw));
    if (index < body.length && body[index] !== ',') return text;
    index += 1;
  }
  return items;
}

/** A node-postgres `types` override: our parser, or the raw text. */
export const resultValueTypes = Object.freeze({
  getTypeParser(oid: number, format?: string): TextParser {
    if (format === 'binary') throw new Error('hypequery requests text-format results only.');
    const element = ARRAY_ELEMENTS[oid];
    if (element !== undefined) {
      const parse = PARSERS[element] ?? identity;
      return (value: string) => parseArrayLiteral(value, parse);
    }
    return PARSERS[oid] ?? identity;
  },
});
