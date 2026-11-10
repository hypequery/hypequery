SELECT event_id, occurred_at, event_type, user_id, path FROM events WHERE tenant_id = ? AND (occurred_at < ? OR (occurred_at = ? AND event_id < ?)) ORDER BY occurred_at DESC, event_id DESC LIMIT 50
