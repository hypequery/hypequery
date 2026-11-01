/**
 * HTTP error with status code and response body
 */
export class HttpError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly body: unknown
  ) {
    super(message);
    this.name = 'HttpError';
    // Maintain proper prototype chain for instanceof checks
    Object.setPrototypeOf(this, HttpError.prototype);
  }
}

/**
 * The server's schema for this endpoint changed since the client was
 * generated (`409 CLIENT_SCHEMA_CHANGED`). Retrying can't fix it: regenerate
 * the client and review what changed.
 */
export class ClientSchemaChangedError extends HttpError {
  constructor(message: string, body: unknown) {
    super(message, 409, body);
    this.name = 'ClientSchemaChangedError';
    Object.setPrototypeOf(this, ClientSchemaChangedError.prototype);
  }
}
