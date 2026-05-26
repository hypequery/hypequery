export function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object';
}

export function isNodeErrorWithCode(error: unknown, code: string): error is NodeJS.ErrnoException {
  return isRecord(error) && error.code === code;
}

export function isNotFoundError(error: unknown): error is NodeJS.ErrnoException {
  return isNodeErrorWithCode(error, 'ENOENT');
}
