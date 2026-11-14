import { defineCloudPublication, publishToCloud } from '@hypequery/datasets';
import { businessContext } from './business-context';
import { Events } from './datasets';

/**
 * What `hypequery deploy analytics/cloud.ts` publishes: the `events` dataset and
 * its business context, in one release, so a rollback moves both together.
 * Any authenticated caller may query `events` (no extra roles or scopes); which
 * customers see it, and as which permission set, is set in Cloud under
 * Customer access.
 */
export const cloud = defineCloudPublication({
  deployment: publishToCloud({
    datasets: { events: Events },
    access: { roles: [], scopes: [] },
  }),
  businessContext,
});
