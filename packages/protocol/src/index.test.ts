import { describe, expect, it } from 'vitest';
import * as protocol from './index.js';

describe('@hypequery/protocol scaffold', () => {
  it('does not expose a protocol before its normative contracts are accepted', () => {
    expect(Object.keys(protocol)).toEqual([]);
  });
});
