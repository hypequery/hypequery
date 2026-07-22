#!/usr/bin/env node
// Reference adapter executable. Wraps @hypequery/protocol behind the RFC 0012
// stdio protocol so the runner can drive it like any other implementation.
import { createStdioAdapter } from '../adapters/stdio.js';
import { REFERENCE_FAMILIES, referenceHandle } from '../adapters/reference.js';

createStdioAdapter({
  implementation: '@hypequery/protocol',
  language: 'typescript',
  families: [...REFERENCE_FAMILIES],
  handle: referenceHandle,
})
  .then((code) => process.exit(code))
  .catch((error) => {
    process.stderr.write(`${String(error)}\n`);
    process.exit(1);
  });
