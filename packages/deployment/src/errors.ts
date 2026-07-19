export type DeploymentIntakeErrorCode =
  | 'HQ_INTAKE_BAD_REQUEST'
  | 'HQ_INTAKE_UNAUTHENTICATED'
  | 'HQ_INTAKE_FORBIDDEN'
  | 'HQ_INTAKE_TOO_LARGE'
  | 'HQ_INTAKE_CONFLICT'
  | 'HQ_INTAKE_INTERNAL';

const ERROR_STATUS: Readonly<Record<DeploymentIntakeErrorCode, number>> = Object.freeze({
  HQ_INTAKE_BAD_REQUEST: 400,
  HQ_INTAKE_UNAUTHENTICATED: 401,
  HQ_INTAKE_FORBIDDEN: 403,
  HQ_INTAKE_TOO_LARGE: 413,
  HQ_INTAKE_CONFLICT: 409,
  HQ_INTAKE_INTERNAL: 500,
});

export class DeploymentIntakeError extends Error {
  readonly code: DeploymentIntakeErrorCode;
  readonly status: number;
  readonly expose: boolean;

  constructor(
    code: DeploymentIntakeErrorCode,
    message: string,
    options: { readonly expose?: boolean; readonly cause?: unknown } = {},
  ) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = 'DeploymentIntakeError';
    this.code = code;
    this.status = ERROR_STATUS[code];
    this.expose = options.expose ?? this.status < 500;
  }
}

export function badRequest(message: string, cause?: unknown): DeploymentIntakeError {
  return new DeploymentIntakeError('HQ_INTAKE_BAD_REQUEST', message, { cause });
}

export function tooLarge(message: string): DeploymentIntakeError {
  return new DeploymentIntakeError('HQ_INTAKE_TOO_LARGE', message);
}
