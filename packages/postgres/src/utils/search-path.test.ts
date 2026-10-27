import { describe, expect, it } from 'vitest';
import { pinnedSearchPath } from './search-path.js';

describe('pinnedSearchPath', () => {
  it('quotes each schema between pg_catalog and pg_temp', () => {
    expect(pinnedSearchPath(['analytics', 'Mixed "Case"'])).toBe('pg_catalog, "analytics", "Mixed ""Case""", pg_temp');
    expect(pinnedSearchPath([])).toBe('pg_catalog, pg_temp');
  });

  it('refuses empty names and the schemas it places itself', () => {
    expect(() => pinnedSearchPath([''])).toThrow(/non-empty/);
    expect(() => pinnedSearchPath(['a\0b'])).toThrow(/non-empty/);
    expect(() => pinnedSearchPath(['pg_temp'])).toThrow(/placed automatically/);
  });
});
