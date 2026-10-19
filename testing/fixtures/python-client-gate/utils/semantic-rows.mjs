import assert from 'node:assert/strict';

const measures = new Set(['revenue', 'profile.total', 'profile.minimum']);
/** Compare decimal strings by exact value, retaining the string/null wire requirement. */
export function semanticRows(rows) {
  return rows.map(row => Object.fromEntries(Object.entries(row).map(([field, value]) => {
    if (!measures.has(field) || value === null) return [field, value];
    assert.equal(typeof value, 'string', 'Aggregate wire values must remain strings');
    assert(/^-?\d+(?:\.\d+)?$/.test(value), 'Expected a finite decimal string');
    const negative = value.startsWith('-');
    const [integer, fraction = ''] = (negative ? value.slice(1) : value).split('.');
    const whole = integer.replace(/^0+(?=\d)/, '');
    const decimal = fraction.replace(/0+$/, '');
    const unsigned = whole + (decimal ? `.${decimal}` : '');
    return [field, negative && unsigned !== '0' ? `-${unsigned}` : unsigned];
  })));
}
