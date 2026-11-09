/**
 * Readable message for a connection failure. Node reports a refused
 * connection to a host with several addresses as an `AggregateError` whose
 * own message is empty; the detail lives on the inner errors and `code`.
 */
export function describeConnectionError(error: unknown): string {
  if (!(error instanceof Error)) {
    return String(error);
  }
  if (error.message) {
    return error.message;
  }

  const inner = error instanceof AggregateError
    ? error.errors.find((cause): cause is Error => cause instanceof Error && cause.message !== '')
    : undefined;
  if (inner) {
    return inner.message;
  }

  const code = (error as { code?: unknown }).code;
  return typeof code === 'string' ? code : error.name;
}
