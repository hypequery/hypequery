import { describe, expect, it } from 'vitest';
import {
  assertValidMigrationSlug,
  createMigrationTimestamp,
  formatMigrationName,
} from './migration-names.js';

describe('migration names', () => {
  it('formats timestamp-prefixed migration names', () => {
    expect(formatMigrationName('20260525130000', 'add_events')).toBe('20260525130000_add_events');
  });

  it('creates compact UTC timestamps', () => {
    expect(createMigrationTimestamp(new Date('2026-05-25T13:00:00.000Z'))).toBe('20260525130000');
  });

  it('rejects unsafe migration slugs', () => {
    expect(() => assertValidMigrationSlug('../bad')).toThrow(/Invalid migration name/);
  });
});
