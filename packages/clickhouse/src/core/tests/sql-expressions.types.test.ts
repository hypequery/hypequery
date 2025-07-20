import { formatDateTime, toDateTime, toStartOfInterval, datePart } from '../utils/sql-expressions.js';

describe('SQL Expressions - Type Safety', () => {
  describe('formatDateTime', () => {
    it('should accept valid parameters', () => {
      // Valid usage: minimal
      formatDateTime('created_at', 'Y-m-d H:i:s');

      // Valid usage: with timezone
      formatDateTime('created_at', 'Y-m-d H:i:s', { timezone: 'UTC' });

      // Valid usage: with alias
      formatDateTime('created_at', 'Y-m-d H:i:s', { alias: 'formatted_date' });

      // Valid usage: with both
      formatDateTime('created_at', 'Y-m-d H:i:s', { timezone: 'UTC', alias: 'formatted_date' });

      // Valid: options object can be empty
      formatDateTime('created_at', 'Y-m-d H:i:s', {});
    });

    it('should reject invalid parameters', () => {
      // Invalid: non-string field
      // @ts-expect-error
      formatDateTime(123, 'Y-m-d H:i:s');

      // Invalid: non-string format
      // @ts-expect-error
      formatDateTime('created_at', 123);

      // Invalid: options.timezone must be string
      // @ts-expect-error
      formatDateTime('created_at', 'Y-m-d H:i:s', { timezone: 123 });

      // Invalid: options.alias must be string
      // @ts-expect-error
      formatDateTime('created_at', 'Y-m-d H:i:s', { alias: 123 });

    });
  });

  describe('toDateTime', () => {
    it('should accept valid parameters', () => {
      toDateTime('created_at');
      toDateTime('created_at', 'date_time');
    });

    it('should reject invalid parameters', () => {
      // Invalid: non-string field
      // @ts-expect-error
      toDateTime(123);

      // Invalid: non-string alias
      // @ts-expect-error
      toDateTime('created_at', 123);
    });
  });

  describe('toStartOfInterval', () => {
    it('should accept valid parameters', () => {
      toStartOfInterval('created_at', '1 day');
      toStartOfInterval('created_at', '1 day', 'day_start');
    });

    it('should reject invalid parameters', () => {
      // Invalid: non-string field
      // @ts-expect-error
      toStartOfInterval(123, '1 day');

      // Invalid: non-string interval
      // @ts-expect-error
      toStartOfInterval('created_at', 123);

      // Invalid: non-string alias
      // @ts-expect-error
      toStartOfInterval('created_at', '1 day', 123);
    });
  });

  describe('datePart', () => {
    it('should accept valid parameters', () => {
      datePart('year', 'created_at');
      datePart('month', 'created_at', 'month_num');
    });

    it('should reject invalid parameters', () => {
      // Invalid: non-valid part
      // @ts-expect-error
      datePart('invalid', 'created_at');

      // Invalid: non-string field
      // @ts-expect-error
      datePart('year', 123);

      // Invalid: non-string alias
      // @ts-expect-error
      datePart('year', 'created_at', 123);
    });

    it('should accept all valid part values', () => {
      // All valid parts should work
      datePart('year', 'created_at');
      datePart('quarter', 'created_at');
      datePart('month', 'created_at');
      datePart('week', 'created_at');
      datePart('day', 'created_at');
      datePart('hour', 'created_at');
      datePart('minute', 'created_at');
      datePart('second', 'created_at');
    });
  });
}); 