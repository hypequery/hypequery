import type { ProtocolDeploymentErrorCode } from './types.js';

export class ProtocolDeploymentError extends TypeError {
  readonly code: ProtocolDeploymentErrorCode;
  readonly path: string;

  constructor(code: ProtocolDeploymentErrorCode, path = '$') {
    super(`${code} at ${path}`);
    this.name = 'ProtocolDeploymentError';
    this.code = code;
    this.path = path;
  }
}

export function deploymentError(
  code: ProtocolDeploymentErrorCode,
  path = '$',
): never {
  throw new ProtocolDeploymentError(code, path);
}
