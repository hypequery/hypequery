import { describe, expect, it } from 'vitest';
import { createFieldNamer } from './field-namer.js';

describe('createFieldNamer', () => {
  it('keeps distinct names and suffixes later holders of a name', () => {
    const name = createFieldNamer([]);
    expect([name('id'), name('pickupCity'), name('pickupCity'), name('pickupCity')]).toEqual([
      'id',
      'pickupCity',
      'pickupCity2',
      'pickupCity3',
    ]);
  });

  it("lets a field take a column's name only when it reads that column", () => {
    const name = createFieldNamer(['fareTotal', 'fare_total']);
    expect(name('fareTotal', 'fareTotal')).toBe('fareTotal');
    expect(name('fareTotal', 'fare_total')).toBe('fareTotal2');
    // Measures and tuple elements read no single column of their own.
    expect(createFieldNamer(['totalFare'])('totalFare')).toBe('totalFare2');
  });

  it('never suffixes onto another column name', () => {
    const name = createFieldNamer(['a', 'a2']);
    expect(name('a')).toBe('a3');
  });
});
