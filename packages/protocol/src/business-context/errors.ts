import type { ProtocolBusinessContextErrorCode } from './types.js';

export class ProtocolBusinessContextError extends TypeError {
  readonly code: ProtocolBusinessContextErrorCode;
  readonly path: string;

  constructor(code: ProtocolBusinessContextErrorCode, path = '$') {
    super(`${code} at ${path}`);
    this.name = 'ProtocolBusinessContextError';
    this.code = code;
    this.path = path;
  }
}

export function businessContextError(
  code: ProtocolBusinessContextErrorCode,
  path = '$',
): never {
  throw new ProtocolBusinessContextError(code, path);
}
