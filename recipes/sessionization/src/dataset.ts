import { dataset, dimension, divide, measure, nullIfZero } from '@hypequery/datasets';

/**
 * Sessions as a dataset. The view (sql/sessions.sql) turns raw events into
 * one row per session with a 30-minute inactivity timeout; the dataset counts
 * and averages those rows, so "sessions per day" or "average session length
 * per tenant" is a query, not new SQL.
 */
export const Sessions = dataset('sessions', {
  source: 'sessionization_sessions',
  timeKey: 'session_start',
  dimensions: {
    tenantId: dimension.number({ column: 'tenant_id', label: 'Tenant' }),
    userId: dimension.number({ column: 'user_id' }),
    sessionNumber: dimension.number({ column: 'session_number', label: "Nth session of the user" }),
    sessionStart: dimension.timestamp({ column: 'session_start', label: 'Session start' }),
    durationSeconds: dimension.number({ column: 'duration_seconds', label: 'Duration (s)' }),
    eventCount: dimension.number({ column: 'event_count', label: 'Events in session' }),
    errorCount: dimension.number({ column: 'error_count' }),
  },
  measures: {
    sessions: measure.count('userId', { label: 'Sessions' }),
    users: measure.countDistinct('userId', { label: 'Users with a session' }),
    avgDurationSeconds: measure.avg('durationSeconds', { label: 'Average session length (s)' }),
    avgEventsPerSession: measure.avg('eventCount', { label: 'Average events per session' }),
    events: measure.sum('eventCount', { label: 'Events' }),
    sessionsPerUser: measure.derived({
      label: 'Sessions per user',
      uses: { sessions: 'sessions', users: 'users' },
      formula: ({ sessions, users }) => divide(sessions, nullIfZero(users)),
    }),
  },
});
