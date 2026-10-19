/** A generated precondition wins over differently cased user/header overrides. */
export function clientSchemaHeaders(headers: Record<string, string>, schemaHash?: string): Record<string, string> {
  if (!schemaHash) return headers;
  return {
    ...Object.fromEntries(Object.entries(headers).filter(([name]) => name.toLowerCase() !== 'x-hypequery-client-schema')),
    'X-Hypequery-Client-Schema': schemaHash,
  };
}
