import { formatDateTime, toDateTime, toStartOfInterval, datePart } from '../src/core/utils/sql-expressions.js';

// Valid usages compile fine
formatDateTime('created_at', 'Y-m-d H:i:s');
formatDateTime('created_at', 'Y-m-d H:i:s', { timezone: 'UTC' });
formatDateTime('created_at', 'Y-m-d H:i:s', { alias: 'formatted_date' });
formatDateTime('created_at', 'Y-m-d H:i:s', { timezone: 'UTC', alias: 'formatted_date' });
formatDateTime('created_at', 'Y-m-d H:i:s', {});

// Invalid cases guarded by ts-expect-error
// @ts-expect-error non-string field
formatDateTime(123, 'Y-m-d H:i:s');
// @ts-expect-error non-string format
formatDateTime('created_at', 123);
// @ts-expect-error timezone must be string
formatDateTime('created_at', 'Y-m-d H:i:s', { timezone: 123 });
// @ts-expect-error alias must be string
formatDateTime('created_at', 'Y-m-d H:i:s', { alias: 123 });

toDateTime('created_at');
toDateTime('created_at', 'alias');
// @ts-expect-error field must be string
 toDateTime(123);
// @ts-expect-error alias must be string
 toDateTime('created_at', 123);

toStartOfInterval('created_at', '1 day');
toStartOfInterval('created_at', '1 day', 'alias');
// @ts-expect-error field must be string
 toStartOfInterval(123, '1 day');
// @ts-expect-error interval must be string
 toStartOfInterval('created_at', 123);
// @ts-expect-error alias must be string
 toStartOfInterval('created_at', '1 day', 123);

datePart('year', 'created_at');
datePart('month', 'created_at', 'month_alias');
datePart('quarter', 'created_at');
datePart('week', 'created_at');
datePart('day', 'created_at');
datePart('hour', 'created_at');
datePart('minute', 'created_at');
datePart('second', 'created_at');
// @ts-expect-error invalid part
 datePart('invalid', 'created_at');
// @ts-expect-error field must be string
 datePart('year', 123);
// @ts-expect-error alias must be string
 datePart('year', 'created_at', 123);
