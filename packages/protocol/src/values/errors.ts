export type ProtocolValueErrorCode =
  | 'HQ_VALUE_INVALID_JSON'
  | 'HQ_VALUE_DUPLICATE_KEY'
  | 'HQ_VALUE_INVALID_UNICODE'
  | 'HQ_VALUE_CONTROL_CHARACTER'
  | 'HQ_VALUE_NON_FINITE_FLOAT'
  | 'HQ_VALUE_NEGATIVE_ZERO'
  | 'HQ_VALUE_INTEGER_TAG_REQUIRED'
  | 'HQ_VALUE_RAW_COMPOSITE'
  | 'HQ_VALUE_UNKNOWN_TAG'
  | 'HQ_VALUE_UNKNOWN_TAG_VERSION'
  | 'HQ_VALUE_UNKNOWN_FIELD'
  | 'HQ_VALUE_INVALID_FORMAT'
  | 'HQ_VALUE_OUT_OF_RANGE'
  | 'HQ_VALUE_TYPE_MISMATCH'
  | 'HQ_VALUE_TOO_DEEP'
  | 'HQ_VALUE_TOO_MANY_NODES'
  | 'HQ_VALUE_TOO_MANY_ITEMS'
  | 'HQ_VALUE_TOO_LARGE'
  | 'HQ_VALUE_UNSAFE_OBJECT';

export class ProtocolValueError extends TypeError {
  readonly code: ProtocolValueErrorCode;
  readonly path: string;

  constructor(code: ProtocolValueErrorCode, path = '$') {
    super(`${code} at ${path}`);
    this.name = 'ProtocolValueError';
    this.code = code;
    this.path = path;
  }
}

export function valueError(
  code: ProtocolValueErrorCode,
  path = '$',
): never {
  throw new ProtocolValueError(code, path);
}
