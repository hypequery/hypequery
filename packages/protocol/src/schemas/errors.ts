import type { ProtocolSchemaErrorCode } from './types.js';

export class ProtocolSchemaError extends TypeError {
  readonly code: ProtocolSchemaErrorCode;
  readonly path: string;

  constructor(code: ProtocolSchemaErrorCode, path = '$') {
    super(`${code} at ${path}`);
    this.name = 'ProtocolSchemaError';
    this.code = code;
    this.path = path;
  }
}

export function schemaError(code: ProtocolSchemaErrorCode, path = '$'): never {
  throw new ProtocolSchemaError(code, path);
}
