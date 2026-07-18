import type { ProtocolDeploymentBundleErrorCode } from './types.js';

export class ProtocolDeploymentBundleError extends TypeError {
  readonly code: ProtocolDeploymentBundleErrorCode;
  readonly path: string;

  constructor(code: ProtocolDeploymentBundleErrorCode, path = '$') {
    super(`${code} at ${path}`);
    this.name = 'ProtocolDeploymentBundleError';
    this.code = code;
    this.path = path;
  }
}

export function bundleError(
  code: ProtocolDeploymentBundleErrorCode,
  path = '$',
): never {
  throw new ProtocolDeploymentBundleError(code, path);
}
