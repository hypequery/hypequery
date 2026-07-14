import { valueError } from './errors.js';
import type { CanonicalValueLimits } from './types.js';

const textEncoder = new TextEncoder();

class DuplicateAwareJsonParser {
  private index = 0;
  private syntaxNodes = 0;

  constructor(
    private readonly source: string,
    private readonly limits: Readonly<CanonicalValueLimits>,
  ) {}

  parse(): unknown {
    this.skipWhitespace();
    const value = this.parseValue(0);
    this.skipWhitespace();
    if (this.index !== this.source.length) {
      valueError('HQ_VALUE_INVALID_JSON');
    }
    return value;
  }

  private parseValue(depth: number): unknown {
    this.syntaxNodes += 1;
    if (this.syntaxNodes > this.limits.maxNodes * 16) {
      valueError('HQ_VALUE_TOO_MANY_NODES');
    }
    if (depth > this.limits.maxDepth * 4 + 8) {
      valueError('HQ_VALUE_TOO_DEEP');
    }

    const token = this.source[this.index];
    if (token === '"') return this.parseString();
    if (token === '{') return this.parseObject(depth + 1);
    if (token === '[') return this.parseArray(depth + 1);
    if (token === 't') return this.parseLiteral('true', true);
    if (token === 'f') return this.parseLiteral('false', false);
    if (token === 'n') return this.parseLiteral('null', null);
    if (token === '-' || (token !== undefined && token >= '0' && token <= '9')) {
      return this.parseNumber();
    }
    valueError('HQ_VALUE_INVALID_JSON');
  }

  private parseLiteral<T>(source: string, value: T): T {
    if (this.source.slice(this.index, this.index + source.length) !== source) {
      valueError('HQ_VALUE_INVALID_JSON');
    }
    this.index += source.length;
    return value;
  }

  private parseObject(depth: number): Record<string, unknown> {
    this.index += 1;
    this.skipWhitespace();
    const result = Object.create(null) as Record<string, unknown>;
    const keys = new Set<string>();

    if (this.source[this.index] === '}') {
      this.index += 1;
      return result;
    }

    while (true) {
      if (this.source[this.index] !== '"') {
        valueError('HQ_VALUE_INVALID_JSON');
      }
      const key = this.parseString();
      if (keys.has(key)) {
        valueError('HQ_VALUE_DUPLICATE_KEY');
      }
      keys.add(key);
      this.skipWhitespace();
      if (this.source[this.index] !== ':') {
        valueError('HQ_VALUE_INVALID_JSON');
      }
      this.index += 1;
      this.skipWhitespace();
      const value = this.parseValue(depth);
      Object.defineProperty(result, key, {
        value,
        enumerable: true,
        configurable: false,
        writable: false,
      });
      this.skipWhitespace();

      const separator = this.source[this.index];
      if (separator === '}') {
        this.index += 1;
        return result;
      }
      if (separator !== ',') {
        valueError('HQ_VALUE_INVALID_JSON');
      }
      this.index += 1;
      this.skipWhitespace();
    }
  }

  private parseArray(depth: number): unknown[] {
    this.index += 1;
    this.skipWhitespace();
    const result: unknown[] = [];

    if (this.source[this.index] === ']') {
      this.index += 1;
      return result;
    }

    while (true) {
      result.push(this.parseValue(depth));
      this.skipWhitespace();
      const separator = this.source[this.index];
      if (separator === ']') {
        this.index += 1;
        return result;
      }
      if (separator !== ',') {
        valueError('HQ_VALUE_INVALID_JSON');
      }
      this.index += 1;
      this.skipWhitespace();
    }
  }

  private parseString(): string {
    this.index += 1;
    let result = '';

    while (this.index < this.source.length) {
      const character = this.source[this.index];
      if (character === '"') {
        this.index += 1;
        return result;
      }
      if (character === '\\') {
        this.index += 1;
        result += this.parseEscape();
        continue;
      }

      const code = this.source.charCodeAt(this.index);
      if (code <= 0x1f) {
        valueError('HQ_VALUE_INVALID_JSON');
      }
      if (code >= 0xd800 && code <= 0xdbff) {
        const low = this.source.charCodeAt(this.index + 1);
        if (low < 0xdc00 || low > 0xdfff) {
          valueError('HQ_VALUE_INVALID_UNICODE');
        }
        result += character + this.source[this.index + 1];
        this.index += 2;
        continue;
      }
      if (code >= 0xdc00 && code <= 0xdfff) {
        valueError('HQ_VALUE_INVALID_UNICODE');
      }
      result += character;
      this.index += 1;
    }

    valueError('HQ_VALUE_INVALID_JSON');
  }

  private parseEscape(): string {
    const escape = this.source[this.index];
    this.index += 1;
    const simple: Record<string, string> = {
      '"': '"',
      '\\': '\\',
      '/': '/',
      b: '\b',
      f: '\f',
      n: '\n',
      r: '\r',
      t: '\t',
    };
    if (escape !== undefined && Object.hasOwn(simple, escape)) {
      return simple[escape];
    }
    if (escape !== 'u') {
      valueError('HQ_VALUE_INVALID_JSON');
    }

    const high = this.parseHexCodeUnit();
    if (high >= 0xd800 && high <= 0xdbff) {
      if (this.source.slice(this.index, this.index + 2) !== '\\u') {
        valueError('HQ_VALUE_INVALID_UNICODE');
      }
      this.index += 2;
      const low = this.parseHexCodeUnit();
      if (low < 0xdc00 || low > 0xdfff) {
        valueError('HQ_VALUE_INVALID_UNICODE');
      }
      return String.fromCharCode(high, low);
    }
    if (high >= 0xdc00 && high <= 0xdfff) {
      valueError('HQ_VALUE_INVALID_UNICODE');
    }
    return String.fromCharCode(high);
  }

  private parseHexCodeUnit(): number {
    const value = this.source.slice(this.index, this.index + 4);
    if (!/^[0-9a-fA-F]{4}$/.test(value)) {
      valueError('HQ_VALUE_INVALID_JSON');
    }
    this.index += 4;
    return Number.parseInt(value, 16);
  }

  private parseNumber(): number {
    const match = this.source.slice(this.index).match(
      /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/,
    );
    if (!match) {
      valueError('HQ_VALUE_INVALID_JSON');
    }
    const token = match[0];
    this.index += token.length;
    const value = Number(token);
    if (!Number.isFinite(value)) {
      valueError('HQ_VALUE_NON_FINITE_FLOAT');
    }
    if (Object.is(value, -0)) {
      valueError('HQ_VALUE_NEGATIVE_ZERO');
    }
    return value;
  }

  private skipWhitespace(): void {
    while (
      this.source[this.index] === ' '
      || this.source[this.index] === '\n'
      || this.source[this.index] === '\r'
      || this.source[this.index] === '\t'
    ) {
      this.index += 1;
    }
  }
}

export function parseDuplicateAwareJson(
  input: string | Uint8Array,
  limits: Readonly<CanonicalValueLimits>,
): unknown {
  let source: string;
  let byteLength: number;

  if (typeof input === 'string') {
    if (input.length > limits.maxInputBytes) {
      valueError('HQ_VALUE_TOO_LARGE');
    }
    source = input;
    byteLength = textEncoder.encode(input).byteLength;
  } else if (input instanceof Uint8Array) {
    byteLength = input.byteLength;
    try {
      source = new TextDecoder('utf-8', { fatal: true }).decode(input);
    } catch {
      valueError('HQ_VALUE_INVALID_UNICODE');
    }
  } else {
    valueError('HQ_VALUE_INVALID_JSON');
  }

  if (byteLength > limits.maxInputBytes) {
    valueError('HQ_VALUE_TOO_LARGE');
  }
  if (source.charCodeAt(0) === 0xfeff) {
    valueError('HQ_VALUE_INVALID_JSON');
  }

  return new DuplicateAwareJsonParser(source, limits).parse();
}
