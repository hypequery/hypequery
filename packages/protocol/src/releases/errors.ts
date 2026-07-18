import type { ProtocolDeploymentReleaseErrorCode } from './types.js';

export class ProtocolDeploymentReleaseError extends TypeError {
  readonly code: ProtocolDeploymentReleaseErrorCode;
  readonly path: string;

  constructor(code: ProtocolDeploymentReleaseErrorCode, path = '$') {
    super(`${code} at ${path}`);
    this.name = 'ProtocolDeploymentReleaseError';
    this.code = code;
    this.path = path;
  }
}

export function releaseError(
  code: ProtocolDeploymentReleaseErrorCode,
  path = '$',
): never {
  throw new ProtocolDeploymentReleaseError(code, path);
}
