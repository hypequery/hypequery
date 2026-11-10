-- Apply the TTL rules to every existing part now instead of waiting for a
-- merge. A mutation; mutations_sync = 1 waits for it.
SYSTEM START MERGES ttl_data_retention_events;

ALTER TABLE ttl_data_retention_events MATERIALIZE TTL SETTINGS mutations_sync = 1;
