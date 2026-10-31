/** Whether a response is the stale-client refusal of a generated endpoint. */
export function isClientSchemaChanged(status: number, body: unknown): boolean {
  if (status !== 409 || typeof body !== 'object' || body === null) return false;
  const error = (body as { error?: { details?: { code?: unknown } } }).error;
  return error?.details?.code === 'CLIENT_SCHEMA_CHANGED';
}
