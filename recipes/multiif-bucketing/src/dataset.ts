import { dataset, dimension, divide, gte, measure, nullIfZero } from '@hypequery/datasets';

/**
 * multiIf(cond1, then1, cond2, then2, ..., else) returns the value of the
 * first condition that is true. Defined once here, the buckets mean the same
 * thing on every dashboard, API and agent that queries the dataset.
 *
 * Buckets are half-open ([100, 250) and so on): `latency_ms < 250` puts a
 * 250 ms request in the next bucket up. Labels do not sort in bucket order,
 * so a numeric `latencyBucketOrder` from the same conditions travels with them.
 */
const LATENCY_BUCKET = `multiIf(latency_ms < 100, '< 100 ms', latency_ms < 250, '100-250 ms', latency_ms < 500, '250-500 ms', latency_ms < 1000, '500 ms-1 s', '>= 1 s')`;

const LATENCY_BUCKET_ORDER = `multiIf(latency_ms < 100, 1, latency_ms < 250, 2, latency_ms < 500, 3, latency_ms < 1000, 4, 5)`;

// Order matters: 429 is also >= 400, so it must be tested first.
const STATUS_CLASS = `multiIf(status_code >= 500, 'server_error', status_code = 429, 'rate_limited', status_code >= 400, 'client_error', 'ok')`;

export const Requests = dataset('requests', {
  source: 'events',
  timeKey: 'occurred_at',
  dimensions: {
    eventId: dimension.number({ column: 'event_id' }),
    occurredAt: dimension.timestamp({ column: 'occurred_at' }),
    statusCode: dimension.number({ column: 'status_code' }),
    latencyMs: dimension.number({ column: 'latency_ms' }),
    latencyBucket: dimension.string({ sql: LATENCY_BUCKET, dependencies: ['latency_ms'], label: 'Latency bucket' }),
    latencyBucketOrder: dimension.number({ sql: LATENCY_BUCKET_ORDER, dependencies: ['latency_ms'], label: 'Latency bucket order' }),
    statusClass: dimension.string({ sql: STATUS_CLASS, dependencies: ['status_code'], label: 'Status class' }),
  },
  measures: {
    requests: measure.count('eventId', { label: 'Requests' }),
    serverErrors: measure.count('eventId', { label: 'Server errors', filters: [gte('statusCode', 500)] }),
    serverErrorRate: measure.derived({
      label: 'Server error rate',
      uses: { errors: 'serverErrors', requests: 'requests' },
      formula: ({ errors, requests }) => divide(errors, nullIfZero(requests)),
    }),
  },
});
