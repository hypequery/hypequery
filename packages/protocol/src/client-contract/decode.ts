import { clientError, ProtocolClientContractError } from './errors.js';
import { CLIENT_MAX_BYTES } from './safe-data.js';
import { pointer } from './primitives.js';
import { validateProtocolClientContract } from './validate.js';
import type { ProtocolClientContract } from './types.js';

/** Bounded JSON parser retaining duplicate members until they can be refused. */
class ClientJsonReader {
  private position = 0;
  private nodes = 0;
  constructor(private readonly input: string) {}
  read(): unknown {
    const result = this.value(1, '');
    this.whitespace();
    if (this.position !== this.input.length) clientError('HQ_CLIENT_TYPE');
    return result;
  }
  private whitespace(): void {
    while (' \t\r\n'.includes(this.input[this.position] ?? '\0')) this.position++;
  }
  private string(): string {
    const start = this.position++;
    while (this.position < this.input.length) {
      const character = this.input[this.position++];
      if (character === '\\') this.position++;
      else if (character === '"') return JSON.parse(this.input.slice(start, this.position)) as string;
    }
    return clientError('HQ_CLIENT_TYPE');
  }
  private value(depth: number, path: string): unknown {
    if (depth > 16 || ++this.nodes > 100_000) clientError('HQ_CLIENT_LIMIT');
    this.whitespace();
    const character = this.input[this.position];
    if (character === '"') return this.string();
    if (character === '{' || character === '[') {
      const object = character === '{';
      const close = object ? '}' : ']';
      const result: Record<string, unknown> = Object.create(null);
      const array: unknown[] = [];
      this.position++;
      this.whitespace();
      if (this.input[this.position] !== close) {
        for (;;) {
          this.whitespace();
          let key = String(array.length);
          if (object) {
            if (this.input[this.position] !== '"') clientError('HQ_CLIENT_TYPE');
            key = this.string();
            if (Object.hasOwn(result, key)) clientError('HQ_CLIENT_DUPLICATE');
            this.whitespace();
            if (this.input[this.position++] !== ':') clientError('HQ_CLIENT_TYPE');
          }
          const child = this.value(depth + 1, pointer(path, key));
          if (object) result[key] = child;
          else array.push(child);
          this.whitespace();
          if (this.input[this.position] !== ',') break;
          this.position++;
        }
      }
      if (this.input[this.position++] !== close) clientError('HQ_CLIENT_TYPE');
      return object ? result : array;
    }
    const match = /^(?:null|true|false|-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?)/.exec(this.input.slice(this.position));
    if (!match) clientError('HQ_CLIENT_TYPE');
    this.position += match[0].length;
    return JSON.parse(match[0]) as unknown;
  }
}
/** Decode untrusted JSON text without accepting duplicate object members. */
export function decodeProtocolClientContract(input: string): ProtocolClientContract {
  if (typeof input !== 'string') clientError('HQ_CLIENT_TYPE');
  if (input.length > CLIENT_MAX_BYTES || new TextEncoder().encode(input).length > CLIENT_MAX_BYTES) {
    clientError('HQ_CLIENT_LIMIT');
  }
  try { return validateProtocolClientContract(new ClientJsonReader(input).read()); }
  catch (error) {
    if (error instanceof ProtocolClientContractError) throw error;
    return clientError('HQ_CLIENT_TYPE');
  }
}
