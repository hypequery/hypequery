import { describe, expect, it } from 'vitest';
import { uniqueNames } from './unique-names.js';

describe('uniqueNames', () => {
  it('keeps distinct names unchanged', () => {
    expect(uniqueNames(['id', 'pickupCity'])).toEqual(['id', 'pickupCity']);
  });

  it('suffixes later holders of a name', () => {
    expect(uniqueNames(['pickupCity', 'pickupCity', 'pickupCity'])).toEqual([
      'pickupCity',
      'pickupCity2',
      'pickupCity3',
    ]);
  });

  it('never takes a suffixed name that appears later in the list', () => {
    expect(uniqueNames(['a', 'a', 'a2'])).toEqual(['a', 'a3', 'a2']);
  });
});
