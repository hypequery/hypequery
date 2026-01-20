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
