import type {
  ProtocolQueryDiagnosticsErrorCode,
  ProtocolQueryEventErrorCode,
} from './types.js';

export class ProtocolQueryEventError extends TypeError {
  readonly code: ProtocolQueryEventErrorCode;
  readonly path: string;

  constructor(code: ProtocolQueryEventErrorCode, path = '$') {
    super(`${code} at ${path}`);
    this.name = 'ProtocolQueryEventError';
    this.code = code;
    this.path = path;
  }
}

export function eventError(
  code: ProtocolQueryEventErrorCode,
  path = '$',
): never {
  throw new ProtocolQueryEventError(code, path);
}

export class ProtocolQueryDiagnosticsError extends TypeError {
  readonly code: ProtocolQueryDiagnosticsErrorCode;
  readonly path: string;

  constructor(code: ProtocolQueryDiagnosticsErrorCode, path = '$') {
    super(`${code} at ${path}`);
    this.name = 'ProtocolQueryDiagnosticsError';
    this.code = code;
    this.path = path;
  }
}

export function diagnosticsError(
  code: ProtocolQueryDiagnosticsErrorCode,
  path = '$',
): never {
  throw new ProtocolQueryDiagnosticsError(code, path);
}
