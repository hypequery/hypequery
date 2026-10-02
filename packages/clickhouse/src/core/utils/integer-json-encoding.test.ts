import { describe, expect, it } from 'vitest';
import { buildIntegerJsonSettings } from './integer-json-encoding.js';

describe('buildIntegerJsonSettings', () => {
  it('preserves own __proto__ settings and merge precedence alongside the default', () => {
    const { settings, adapterDefaultApplied } = buildIntegerJsonSettings(
      'quoted',
      { ['__proto__']: 'custom-value', max_threads: 4 },
      { max_threads: 8 },
    );

    expect(Object.prototype.hasOwnProperty.call(settings, '__proto__')).toBe(true);
    expect(settings['__proto__']).toBe('custom-value');
    expect(settings.max_threads).toBe(8);
    expect(settings.output_format_json_quote_64bit_integers).toBe(1);
    expect(adapterDefaultApplied).toBe(true);
    expect(Object.getPrototypeOf(settings)).toBe(Object.prototype);
  });
});
