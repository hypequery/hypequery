import { dataset, dimension, divide, measure, nullIfZero } from '@hypequery/datasets';

/**
 * Retention as a dataset. The view (sql/cohort-activity.sql) yields one row
 * per user per active week with the cohort it belongs to; the dataset turns
 * that into cohort size, active users and a retention ratio that callers can
 * slice by cohort and by weeks since signup without rewriting the SQL.
 */
export const CohortRetention = dataset('cohortRetention', {
  source: 'user_cohort_activity',
  timeKey: 'cohort_week',
  timeGrains: ['week', 'month', 'quarter'],
  dimensions: {
    cohortWeek: dimension.timestamp({ column: 'cohort_week', label: 'Signup week' }),
    weeksSinceSignup: dimension.number({ column: 'weeks_since_signup', label: 'Weeks since signup' }),
    userId: dimension.number({ column: 'user_id' }),
    cohortSizeColumn: dimension.number({ column: 'cohort_size' }),
  },
  measures: {
    activeUsers: measure.countDistinct('userId', { label: 'Active users' }),
    // Every row of a cohort carries the same cohort_size, so max() reads it back.
    cohortSize: measure.max('cohortSizeColumn', { label: 'Cohort size' }),
    retention: measure.derived({
      label: 'Retention',
      description: 'Share of the signup cohort active in the week',
      uses: { active: 'activeUsers', size: 'cohortSize' },
      formula: ({ active, size }) => divide(active, nullIfZero(size)),
    }),
  },
});
