export const CLIENT_ERROR_MESSAGES = Object.freeze({
  HQ_CLIENT_TYPE: 'Expected plain JSON data.',
  HQ_CLIENT_LIMIT: 'Client contract exceeds validation limits.',
  HQ_CLIENT_VERSION: 'Unsupported client contract version.',
  HQ_CLIENT_UNKNOWN_FIELD: 'Unknown client contract field.',
  HQ_CLIENT_SHAPE: 'Invalid client contract shape.',
  HQ_CLIENT_IDENTIFIER: 'Invalid client contract identifier.',
  HQ_CLIENT_DUPLICATE: 'Duplicate client contract entry.',
  HQ_CLIENT_PATH: 'Invalid client endpoint path.',
  HQ_CLIENT_REFERENCE: 'Inconsistent client contract reference.',
  HQ_CLIENT_IDENTITY: 'Client contract identity does not match.',
  HQ_CLIENT_QUERY: 'Invalid client query.',
});
export type ProtocolClientContractErrorCode = keyof typeof CLIENT_ERROR_MESSAGES;
export class ProtocolClientContractError extends TypeError {
  readonly code: ProtocolClientContractErrorCode;
  readonly path: string;
  constructor(code: ProtocolClientContractErrorCode, path = '') {
    super(CLIENT_ERROR_MESSAGES[code]);
    this.name = 'ProtocolClientContractError';
    this.code = code;
    this.path = path;
  }
}
export function clientError(code: ProtocolClientContractErrorCode, path = ''): never {
  throw new ProtocolClientContractError(code, path);
}
