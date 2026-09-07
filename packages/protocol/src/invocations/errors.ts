import type { ProtocolSemanticInvocationErrorCode } from './types.js';

export class ProtocolSemanticInvocationError extends TypeError {
  readonly code: ProtocolSemanticInvocationErrorCode;
  readonly path: string;

  constructor(code: ProtocolSemanticInvocationErrorCode, path = '$') {
    super(`${code} at ${path}`);
    this.name = 'ProtocolSemanticInvocationError';
    this.code = code;
    this.path = path;
  }
}

export function invocationError(
  code: ProtocolSemanticInvocationErrorCode,
  path = '$',
): never {
  throw new ProtocolSemanticInvocationError(code, path);
}
