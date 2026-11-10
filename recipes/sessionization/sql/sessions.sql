-- One row per session: a run of a user's events with no gap longer than 30
-- minutes. Two window passes over each user's events, in time order:
--   1. lagInFrame reads the previous event's time. The first event has no
--      previous row and gets the default, 1970-01-01, so it always opens a
--      session.
--   2. A running sum of "gap > 1800 seconds" numbers the sessions 1, 2, 3...
-- Then an ordinary GROUP BY collapses each session to one row.
--
-- lagInFrame only sees rows inside the window frame. The default frame ends
-- at the current row, which is enough for lag, but leadInFrame under the
-- default frame returns the default value for almost every row. The frame is
-- spelled out so switching to lead (gap to the next event) stays correct.
-- event_id breaks ties between same-second events.
CREATE OR REPLACE VIEW sessionization_sessions AS
WITH
    gaps AS
    (
        SELECT
            tenant_id,
            user_id,
            event_id,
            event_type,
            occurred_at,
            lagInFrame(occurred_at, 1, toDateTime(0, 'UTC')) OVER w AS previous_at
        FROM events
        WINDOW w AS (PARTITION BY tenant_id, user_id ORDER BY occurred_at, event_id
                     ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW)
    ),
    numbered AS
    (
        SELECT
            *,
            sum(toUInt32(dateDiff('second', previous_at, occurred_at) > 1800)) OVER w AS session_number
        FROM gaps
        WINDOW w AS (PARTITION BY tenant_id, user_id ORDER BY occurred_at, event_id
                     ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW)
    )
SELECT
    tenant_id,
    user_id,
    session_number,
    min(occurred_at)                                        AS session_start,
    max(occurred_at)                                        AS session_end,
    dateDiff('second', min(occurred_at), max(occurred_at))  AS duration_seconds,
    count()                                                 AS event_count,
    countIf(event_type = 'error')                           AS error_count
FROM numbered
GROUP BY tenant_id, user_id, session_number;
