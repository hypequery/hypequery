import type { ProtocolFieldVisibilityErrorCode } from './types.js';

export class ProtocolFieldVisibilityError extends TypeError {
  readonly code: ProtocolFieldVisibilityErrorCode;
  readonly path: string;

  constructor(code: ProtocolFieldVisibilityErrorCode, path = '$') {
    super(`${code} at ${path}`);
    this.name = 'ProtocolFieldVisibilityError';
    this.code = code;
    this.path = path;
  }
}

export function visibilityError(code: ProtocolFieldVisibilityErrorCode, path = '$'): never {
  throw new ProtocolFieldVisibilityError(code, path);
}
