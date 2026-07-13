import { describe, expect, it } from 'vitest';
import * as protocol from './index.js';

describe('@hypequery/protocol scaffold', () => {
  it('exports only the reviewed canonical value surface', () => {
    expect(Object.keys(protocol).sort()).toEqual([
      'DEFAULT_CANONICAL_VALUE_LIMITS',
      'ProtocolValueError',
      'decodeCanonicalValue',
      'encodeCanonicalValue',
      'encodeCanonicalValueToString',
      'hashCanonicalValue',
      'validateCanonicalValue',
    ]);
  });
});
