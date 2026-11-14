import { publishToCloud } from '@hypequery/datasets';
import { Events } from './datasets';

/**
 * What `hypequery deploy analytics/cloud.ts` publishes. Any authenticated
 * caller may query `events` (no extra roles or scopes); which customers see
 * it, and as which permission set, is set in Cloud under Customer access.
 */
export const cloud = publishToCloud({
  datasets: { events: Events },
  access: { roles: [], scopes: [] },
});
