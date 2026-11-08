-- One row per (user, week they were active), tagged with the user's signup
-- cohort and the cohort's size. A view, so the semantic layer can treat
-- "retention" as an ordinary dataset: the join and the window function live
-- here, once, instead of in every dashboard query.
CREATE OR REPLACE VIEW user_cohort_activity AS
WITH cohorts AS
(
    SELECT
        user_id,
        toStartOfWeek(signed_up_at, 1)                               AS cohort_week,
        count() OVER (PARTITION BY toStartOfWeek(signed_up_at, 1))  AS cohort_size
    FROM users
)
SELECT
    c.cohort_week,
    c.cohort_size,
    c.user_id,
    toStartOfWeek(e.occurred_at, 1)                                    AS active_week,
    dateDiff('week', c.cohort_week, toStartOfWeek(e.occurred_at, 1))   AS weeks_since_signup
FROM cohorts AS c
INNER JOIN events AS e ON e.user_id = c.user_id
WHERE e.occurred_at >= c.cohort_week
GROUP BY c.cohort_week, c.cohort_size, c.user_id, active_week;
