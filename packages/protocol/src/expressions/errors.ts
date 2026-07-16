import type { ProtocolExpressionErrorCode } from './types.js';

export class ProtocolExpressionError extends TypeError {
  readonly code: ProtocolExpressionErrorCode;
  readonly path: string;

  constructor(code: ProtocolExpressionErrorCode, path = '$') {
    super(`${code} at ${path}`);
    this.name = 'ProtocolExpressionError';
    this.code = code;
    this.path = path;
  }
}

export function expressionError(code: ProtocolExpressionErrorCode, path = '$'): never {
  throw new ProtocolExpressionError(code, path);
}
