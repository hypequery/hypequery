import type { ProtocolQueryImplementationErrorCode } from './types.js';

export class ProtocolQueryImplementationError extends TypeError {
  readonly code: ProtocolQueryImplementationErrorCode;
  readonly path: string;

  constructor(code: ProtocolQueryImplementationErrorCode, path = '$') {
    super(`${code} at ${path}`);
    this.name = 'ProtocolQueryImplementationError';
    this.code = code;
    this.path = path;
  }
}

export function queryImplementationError(
  code: ProtocolQueryImplementationErrorCode,
  path = '$',
): never {
  throw new ProtocolQueryImplementationError(code, path);
}
