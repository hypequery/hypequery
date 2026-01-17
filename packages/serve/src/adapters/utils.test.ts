import { describe, it, expect } from 'vitest';
import {
  normalizeHeaders,
  parseQueryParams,
  parseRequestBody,
  serializeResponseBody,
} from './utils.js';

describe('Adapter Utilities', () => {
  describe('normalizeHeaders', () => {
    it('normalizes Node.js headers with string values', () => {
      const input = {
        'content-type': 'application/json',
        'authorization': 'Bearer token123',
      };

      const result = normalizeHeaders(input);

      expect(result).toEqual({
        'content-type': 'application/json',
        'authorization': 'Bearer token123',
      });
    });

    it('joins array header values with comma-space', () => {
      const input = {
        'accept': ['application/json', 'text/html'],
        'x-custom': ['value1', 'value2', 'value3'],
      };

      const result = normalizeHeaders(input);

      expect(result).toEqual({
        'accept': 'application/json, text/html',
        'x-custom': 'value1, value2, value3',
      });
    });

    it('handles undefined header values', () => {
      const input = {
        'content-type': 'application/json',
        'x-optional': undefined,
      };

      const result = normalizeHeaders(input);

      expect(result).toEqual({
        'content-type': 'application/json',
      });
    });

    it('handles mixed string and array headers', () => {
      const input = {
        'content-type': 'application/json',
        'accept': ['text/html', 'application/xml'],
        'authorization': 'Bearer token',
      };

      const result = normalizeHeaders(input);

      expect(result).toEqual({
        'content-type': 'application/json',
        'accept': 'text/html, application/xml',
        'authorization': 'Bearer token',
      });
    });

    it('handles empty headers object', () => {
      const result = normalizeHeaders({});
      expect(result).toEqual({});
    });

    it('normalizes Web API Headers', () => {
      const headers = new Headers();
      headers.set('content-type', 'application/json');
      headers.set('authorization', 'Bearer token');

      const result = normalizeHeaders(headers);

      expect(result).toEqual({
        'content-type': 'application/json',
        'authorization': 'Bearer token',
      });
    });

    it('handles case-sensitive header keys', () => {
      const input = {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer token',
      };

      const result = normalizeHeaders(input);

      expect(result).toEqual({
        'Content-Type': 'application/json',
        'Authorization': 'Bearer token',
      });
    });

    it('preserves header key casing from input', () => {
      const input = {
        'X-Custom-Header': 'value',
        'x-lowercase': 'value2',
      };

      const result = normalizeHeaders(input);

      expect(result).toEqual({
        'X-Custom-Header': 'value',
        'x-lowercase': 'value2',
      });
    });
  });

  describe('parseQueryParams', () => {
    it('parses single-value query parameters', () => {
      const params = new URLSearchParams('name=John&age=30');

      const result = parseQueryParams(params);

      expect(result).toEqual({
        name: 'John',
        age: '30',
      });
    });

    it('creates arrays for duplicate parameter names', () => {
      const params = new URLSearchParams('tags=react&tags=typescript&tags=nodejs');

      const result = parseQueryParams(params);

      expect(result).toEqual({
        tags: ['react', 'typescript', 'nodejs'],
      });
    });

    it('handles mixed single and multiple values', () => {
      const params = new URLSearchParams('name=John&tags=react&tags=typescript&age=30');

      const result = parseQueryParams(params);

      expect(result).toEqual({
        name: 'John',
        tags: ['react', 'typescript'],
        age: '30',
      });
    });

    it('handles empty query string', () => {
      const params = new URLSearchParams('');

      const result = parseQueryParams(params);

      expect(result).toEqual({});
    });

    it('handles URL-encoded values', () => {
      const params = new URLSearchParams('message=Hello%20World&email=test%40example.com');

      const result = parseQueryParams(params);

      expect(result).toEqual({
        message: 'Hello World',
        email: 'test@example.com',
      });
    });

    it('handles special characters in parameter names', () => {
      const params = new URLSearchParams('filter[name]=John&sort[field]=age');

      const result = parseQueryParams(params);

      expect(result).toEqual({
        'filter[name]': 'John',
        'sort[field]': 'age',
      });
    });

    it('preserves empty string values', () => {
      const params = new URLSearchParams('name=&age=30');

      const result = parseQueryParams(params);

      expect(result).toEqual({
        name: '',
        age: '30',
      });
    });

    it('handles parameters with no values', () => {
      const params = new URLSearchParams('debug&verbose');

      const result = parseQueryParams(params);

      expect(result).toEqual({
        debug: '',
        verbose: '',
      });
    });
  });

  describe('parseRequestBody', () => {
    it('parses JSON from Node.js Buffer', async () => {
      const buffer = Buffer.from(JSON.stringify({ name: 'John', age: 30 }));

      const result = await parseRequestBody(buffer, 'application/json');

      expect(result).toEqual({ name: 'John', age: 30 });
    });

    it('returns string for invalid JSON in Buffer', async () => {
      const buffer = Buffer.from('not valid json');

      const result = await parseRequestBody(buffer, 'application/json');

      expect(result).toBe('not valid json');
    });

    it('returns undefined for empty Buffer', async () => {
      const buffer = Buffer.from('');

      const result = await parseRequestBody(buffer, 'application/json');

      expect(result).toBeUndefined();
    });

    it('returns string for non-JSON Buffer content', async () => {
      const buffer = Buffer.from('plain text content');

      const result = await parseRequestBody(buffer, 'text/plain');

      expect(result).toBe('plain text content');
    });

    it('parses JSON from Web API Request', async () => {
      const request = new Request('http://localhost', {
        method: 'POST',
        body: JSON.stringify({ name: 'John' }),
        headers: { 'content-type': 'application/json' },
      });

      const result = await parseRequestBody(request, 'application/json');

      expect(result).toEqual({ name: 'John' });
    });

    it('returns undefined for Request with invalid JSON', async () => {
      const request = new Request('http://localhost', {
        method: 'POST',
        body: 'invalid json',
        headers: { 'content-type': 'application/json' },
      });

      const result = await parseRequestBody(request, 'application/json');

      expect(result).toBeUndefined();
    });

    it('parses text from Web API Request', async () => {
      const request = new Request('http://localhost', {
        method: 'POST',
        body: 'Hello World',
        headers: { 'content-type': 'text/plain' },
      });

      const result = await parseRequestBody(request, 'text/plain');

      expect(result).toBe('Hello World');
    });

    it('returns undefined for Request without content-type', async () => {
      const request = new Request('http://localhost', {
        method: 'POST',
        body: 'some content',
      });

      const result = await parseRequestBody(request, undefined);

      expect(result).toBeUndefined();
    });
  });

  describe('serializeResponseBody', () => {
    it('serializes object to JSON with application/json content-type', () => {
      const body = { name: 'John', age: 30 };

      const result = serializeResponseBody(body, 'application/json');

      expect(result).toBe('{"name":"John","age":30}');
    });

    it('serializes null to "null" for JSON content-type', () => {
      const result = serializeResponseBody(null, 'application/json');

      expect(result).toBe('null');
    });

    it('serializes undefined to "null" for JSON content-type', () => {
      const result = serializeResponseBody(undefined, 'application/json');

      expect(result).toBe('null');
    });

    it('passes through string values as-is for non-JSON content-type', () => {
      const result = serializeResponseBody('Hello World', 'text/plain');

      expect(result).toBe('Hello World');
    });

    it('passes through string values for JSON content-type', () => {
      const result = serializeResponseBody('Already a string', 'application/json');

      expect(result).toBe('Already a string');
    });

    it('defaults to JSON serialization without content-type', () => {
      const body = { data: 'test' };

      const result = serializeResponseBody(body);

      expect(result).toBe('{"data":"test"}');
    });

    it('handles arrays correctly with JSON content-type', () => {
      const body = [1, 2, 3, 4, 5];

      const result = serializeResponseBody(body, 'application/json');

      expect(result).toBe('[1,2,3,4,5]');
    });

    it('handles content-type with charset', () => {
      const body = { message: 'Hello' };

      const result = serializeResponseBody(body, 'application/json; charset=utf-8');

      expect(result).toBe('{"message":"Hello"}');
    });
  });
});
