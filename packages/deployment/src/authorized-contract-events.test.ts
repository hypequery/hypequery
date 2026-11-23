/**
 * RFC 0027 event datasets under RFC 0019 visibility: a policy that hides a
 * field the `events` declaration names must not make the narrowed contract
 * invalid, which would leave the caller with no catalog at all.
 */

import { readFileSync } from 'node:fs';
import { validateProtocolDeploymentContract } from '@hypequery/protocol';
import { describe, expect, it } from 'vitest';
import { projectAuthorizedDeploymentContract } from './authorized-contract.js';

const PUBLIC = { access: { kind: 'public' }, tenant: { kind: 'not-required' } } as const;

const fixture = (JSON.parse(readFileSync(
  new URL('../../../specs/security-protocol/fixtures/deployments-v2/success.json', import.meta.url), 'utf8',
)) as { id: string; value: { datasets: Record<string, unknown>[] } }[]).find(entry => entry.id === 'event-dataset')!.value;

// `activity`: events { entity: userId, event: eventName }, timeField occurredAt.
const activity = { ...fixture.datasets[0]!, endpoint: PUBLIC };
const contract = validateProtocolDeploymentContract({ ...fixture, datasets: [activity] });
const ALL = ['userId', 'accountId', 'eventName', 'plan', 'occurredAt'];

function project(dimensions: string[]) {
  return projectAuthorizedDeploymentContract(contract, null, {
    visibility: { kind: 'hypequery-field-visibility', version: 1, datasets: { activity: { dimensions, measures: '*' } } },
  }).contract.datasets[0] as { events?: unknown; timeField?: unknown };
}

describe('event datasets in the authorized projection', () => {
  it('keeps the declaration when every field it names is visible', () => {
    expect(project(ALL).events).toEqual({ entity: 'userId', event: 'eventName' });
  });

  it.each([
    ['the entity', 'userId'],
    ['the time field', 'occurredAt'],
  ])('drops it, keeping the dataset discoverable, when %s is hidden', (_name, hidden) => {
    const dataset = project(ALL.filter(name => name !== hidden));
    expect(dataset).toBeDefined();
    expect(dataset.events).toBeUndefined();
  });

  it('narrows it to the entity when only the event dimension is hidden', () => {
    expect(project(ALL.filter(name => name !== 'eventName')).events).toEqual({ entity: 'userId' });
  });

  it('drops it from a dataset retained only to support a join', () => {
    const orders = {
      name: 'orders', source: 'analytics.orders', tenant: { kind: 'not-required' }, endpoint: PUBLIC,
      dimensions: [{ name: 'userId', type: 'string', source: { kind: 'column', column: 'userId' }, filterable: true, groupable: true }],
      measures: [], filters: [],
      relationships: [{ name: 'activity', kind: 'belongsTo', target: 'activity', from: 'userId', to: 'userId', queryable: true }],
    };
    const joined = validateProtocolDeploymentContract({ ...fixture, datasets: [{ ...activity, endpoint: undefined }, orders] });
    const projected = projectAuthorizedDeploymentContract(joined, null).contract;
    const retained = projected.datasets.find(entry => String(entry.name) === 'activity') as { events?: unknown } | undefined;
    expect(retained).toBeDefined();
    expect(retained!.events).toBeUndefined();
  });
});
