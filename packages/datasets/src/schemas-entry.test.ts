import { describe, expect, it } from 'vitest';
import * as root from './index.js';
import * as schemas from './schemas.js';

describe('@hypequery/datasets/schemas entry', () => {
  it('keeps every deprecated root re-export identical to the schemas entry', () => {
    const runtimeExports = Object.keys(schemas) as Array<keyof typeof schemas>;
    expect(runtimeExports.length).toBeGreaterThan(0);
    for (const name of runtimeExports) {
      expect(root[name as keyof typeof root], name).toBe(schemas[name]);
    }
  });

  it('lets callers catch the root error class from either entry', () => {
    const error = new schemas.ProtocolSchemaAdapterError('Unsupported', '$.value');
    expect(error).toBeInstanceOf(root.ProtocolSchemaAdapterError);
  });
});
