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

/** A node-postgres `types` override: our parser, or the raw text. */
export const resultValueTypes = Object.freeze({
  getTypeParser(oid: number, format?: string): TextParser {
    if (format === 'binary') throw new Error('hypequery requests text-format results only.');
    return PARSERS[oid] ?? identity;
  },
});
