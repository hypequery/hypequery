import { badRequest, tooLarge } from './errors.js';

const CRLF = Buffer.from('\r\n');
const HEADER_NAME = /^[A-Za-z0-9-]+$/;
const HEADER_VALUE = /^[\x20-\x7e]*$/;

export interface MultipartPartHeaders {
  readonly name: string;
  readonly filename: string;
  readonly contentType: string;
  readonly bundlePath?: string;
}

export class BoundedMultipartReader {
  readonly #iterator: AsyncIterator<Uint8Array>;
  readonly #boundary: Buffer;
  readonly #declaredLength: number;
  readonly #maximumLength: number;
  readonly #maximumHeaderBytes: number;
  readonly #signal?: AbortSignal;
  #buffer: Buffer<ArrayBufferLike> = Buffer.alloc(0);
  #received = 0;
  #finished = false;
  #started = false;

  constructor(
    body: AsyncIterable<Uint8Array>,
    boundary: string,
    declaredLength: number,
    maximumLength: number,
    maximumHeaderBytes: number,
    signal?: AbortSignal,
  ) {
    this.#iterator = body[Symbol.asyncIterator]();
    this.#boundary = Buffer.from(`--${boundary}`);
    this.#declaredLength = declaredLength;
    this.#maximumLength = maximumLength;
    this.#maximumHeaderBytes = maximumHeaderBytes;
    this.#signal = signal;
  }

  #throwIfAborted(): void {
    if (this.#signal?.aborted) {
      throw badRequest('The deployment request was aborted.', this.#signal.reason);
    }
  }

  async #fill(): Promise<boolean> {
    while (!this.#finished) {
      this.#throwIfAborted();
      let item: IteratorResult<Uint8Array>;
      try {
        item = await this.#iterator.next();
      } catch (error) {
        throw badRequest('The deployment request body could not be read.', error);
      }
      if (item.done) {
        this.#finished = true;
        return false;
      }
      if (!(item.value instanceof Uint8Array)) {
        throw badRequest('The deployment request body yielded a non-byte chunk.');
      }
      if (item.value.byteLength === 0) continue;
      this.#received += item.value.byteLength;
      if (this.#received > this.#declaredLength) {
        throw badRequest('The deployment request body exceeds its Content-Length.');
      }
      if (this.#received > this.#maximumLength) {
        throw tooLarge('The deployment request exceeds its byte limit.');
      }
      const chunk = Buffer.from(item.value.buffer, item.value.byteOffset, item.value.byteLength);
      this.#buffer = this.#buffer.length === 0 ? chunk : Buffer.concat([this.#buffer, chunk]);
      return true;
    }
    return false;
  }

  async #readBytes(length: number): Promise<Buffer> {
    while (this.#buffer.length < length && await this.#fill()) {
      // Fill until the requested framing bytes are available.
    }
    if (this.#buffer.length < length) throw badRequest('The multipart request is truncated.');
    const value = this.#buffer.subarray(0, length);
    this.#buffer = this.#buffer.subarray(length);
    return value;
  }

  async #readLine(maximum: number): Promise<string> {
    for (;;) {
      const index = this.#buffer.indexOf(CRLF);
      if (index >= 0) {
        if (index > maximum) throw tooLarge('Multipart part headers exceed their byte limit.');
        const bytes = this.#buffer.subarray(0, index);
        this.#buffer = this.#buffer.subarray(index + CRLF.length);
        if (!HEADER_VALUE.test(bytes.toString('latin1'))) {
          throw badRequest('Multipart headers must contain printable ASCII.');
        }
        return bytes.toString('ascii');
      }
      if (this.#buffer.length > maximum) {
        throw tooLarge('Multipart part headers exceed their byte limit.');
      }
      if (!await this.#fill()) throw badRequest('The multipart request is truncated.');
    }
  }

  async start(): Promise<void> {
    if (this.#started) throw new Error('Multipart reader has already started.');
    this.#started = true;
    const opening = await this.#readBytes(this.#boundary.length + CRLF.length);
    if (!opening.equals(Buffer.concat([this.#boundary, CRLF]))) {
      throw badRequest('The multipart body does not begin with its declared boundary.');
    }
  }

  async readPartHeaders(): Promise<MultipartPartHeaders> {
    if (!this.#started) throw new Error('Multipart reader has not started.');
    const headers = new Map<string, string>();
    let consumed = 0;
    for (;;) {
      const line = await this.#readLine(this.#maximumHeaderBytes - consumed);
      consumed += Buffer.byteLength(line) + CRLF.length;
      if (consumed > this.#maximumHeaderBytes) {
        throw tooLarge('Multipart part headers exceed their byte limit.');
      }
      if (line === '') break;
      if (/^[ \t]/.test(line)) throw badRequest('Folded multipart headers are not supported.');
      const separator = line.indexOf(':');
      if (separator < 1) throw badRequest('Multipart part header syntax is invalid.');
      const name = line.slice(0, separator);
      const value = line.slice(separator + 1).trim();
      const normalized = name.toLowerCase();
      if (!HEADER_NAME.test(name) || headers.has(normalized)) {
        throw badRequest('Multipart part headers contain an invalid or duplicate field.');
      }
      headers.set(normalized, value);
    }
    const allowed = new Set([
      'content-disposition',
      'content-type',
      'x-hypequery-bundle-path',
    ]);
    if ([...headers.keys()].some(name => !allowed.has(name))) {
      throw badRequest('Multipart parts contain an unsupported header.');
    }
    const disposition = headers.get('content-disposition');
    const match = disposition?.match(/^form-data; name="(release|bundle)"; filename="([^"\r\n]+)"$/);
    const contentType = headers.get('content-type');
    if (!match || !contentType) throw badRequest('Multipart part headers are incomplete.');
    return Object.freeze({
      name: match[1]!,
      filename: match[2]!,
      contentType,
      ...(headers.has('x-hypequery-bundle-path')
        ? { bundlePath: headers.get('x-hypequery-bundle-path')! }
        : {}),
    });
  }

  /** Returns true when this was the final part. */
  async readPartBody(
    maximum: number,
    consume: (chunk: Uint8Array) => void | Promise<void>,
  ): Promise<{ readonly final: boolean; readonly byteLength: number }> {
    const marker = Buffer.concat([CRLF, this.#boundary]);
    const retained = marker.length - 1;
    let byteLength = 0;
    const emit = async (chunk: Buffer): Promise<void> => {
      if (chunk.length === 0) return;
      this.#throwIfAborted();
      byteLength += chunk.length;
      if (byteLength > maximum) throw tooLarge('A multipart part exceeds its byte limit.');
      await consume(chunk);
    };
    for (;;) {
      const index = this.#buffer.indexOf(marker);
      if (index >= 0) {
        await emit(this.#buffer.subarray(0, index));
        this.#buffer = this.#buffer.subarray(index + marker.length);
        break;
      }
      if (this.#buffer.length > retained) {
        const flushLength = this.#buffer.length - retained;
        await emit(this.#buffer.subarray(0, flushLength));
        this.#buffer = this.#buffer.subarray(flushLength);
      }
      if (!await this.#fill()) throw badRequest('The multipart request is truncated.');
    }
    const suffix = await this.#readBytes(2);
    if (suffix.equals(CRLF)) return Object.freeze({ final: false, byteLength });
    if (!suffix.equals(Buffer.from('--'))) throw badRequest('The multipart boundary is invalid.');
    if (!(await this.#readBytes(2)).equals(CRLF)) {
      throw badRequest('The final multipart boundary is invalid.');
    }
    return Object.freeze({ final: true, byteLength });
  }

  async finish(): Promise<void> {
    if (this.#buffer.length > 0) throw badRequest('The multipart request has trailing bytes.');
    while (await this.#fill()) {
      if (this.#buffer.length > 0) throw badRequest('The multipart request has trailing bytes.');
    }
    if (this.#received !== this.#declaredLength) {
      throw badRequest('The deployment request body does not match its Content-Length.');
    }
  }
}
