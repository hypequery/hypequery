-- One row per (tenant, user, month): how far the user got through
-- login -> query_run -> export, where every step must happen within 24 hours
-- of the login that started the attempt (default windowFunnel mode).
--
-- windowFunnel is an aggregate over a user's whole event stream, so it cannot
-- be a dataset measure (a measure would have to nest it inside count()). It
-- lives here, once; the dataset then counts users per funnel level like any
-- other column.
--
-- The WHERE keeps only the three funnel events. The default mode ignores
-- every other event anyway, so the levels are the same and the view reads
-- fewer rows. Do not copy this pre-filter into a 'strict_order' funnel: that
-- mode stops at any intervening event, so it changes the answer.
CREATE OR REPLACE VIEW funnel_windowfunnel_user_levels AS
SELECT
    tenant_id,
    user_id,
    toStartOfMonth(occurred_at) AS month,
    windowFunnel(86400)(
        occurred_at,
        event_type = 'login',
        event_type = 'query_run',
        event_type = 'export'
    ) AS funnel_level
FROM events
WHERE event_type IN ('login', 'query_run', 'export')
GROUP BY tenant_id, user_id, month;
