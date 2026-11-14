import { ProtocolBusinessContextError } from '@hypequery/protocol';
import { describe, expect, it } from 'vitest';
import { defineBusinessContext, defineCloudPublication } from './cloud-publication.js';
import { publishToCloud } from './cloud-publishing.js';
import { dataset } from './dataset.js';
import { dimension } from './field.js';

const Orders = dataset('orders', {
  source: 'analytics.orders',
  dimensions: { id: dimension.string() },
});
const deployment = publishToCloud({ access: { roles: [], scopes: [] }, datasets: { orders: Orders } });

describe('defineBusinessContext', () => {
  it('adds the document header and canonicalises text', () => {
    const context = defineBusinessContext({
      summary: ' Grocery delivery ',
      glossary: [{ term: 'active customer', meaning: 'ordered in the last 30 days' }],
      caveats: [],
    });
    expect(context).toEqual({
      kind: 'hypequery-business-context',
      version: 1,
      summary: 'Grocery delivery',
      glossary: [{ term: 'active customer', meaning: 'ordered in the last 30 days' }],
    });
  });

  it('reports the path of an invalid entry', () => {
    expect(() => defineBusinessContext({
      glossary: [{ term: 'AOV', meaning: 'a' }, { term: 'aov', meaning: 'b' }],
    })).toThrow(ProtocolBusinessContextError);
    expect(() => defineBusinessContext({
      glossary: [{ term: 'AOV', meaning: 'a' }, { term: 'aov', meaning: 'b' }],
    })).toThrow('$.glossary[1].term');
  });
});

describe('defineCloudPublication', () => {
  it('packages a deployment with business context', () => {
    const cloud = defineCloudPublication({
      deployment,
      businessContext: { industry: 'Retail', kpis: [{ name: 'GMV', definition: 'Gross value' }] },
    });
    expect(cloud.kind).toBe('hypequery-cloud-publication');
    expect(cloud.version).toBe(1);
    expect(cloud.deployment).toBe(deployment);
    expect(cloud.businessContext).toMatchObject({
      kind: 'hypequery-business-context',
      industry: 'Retail',
    });
    expect(Object.isFrozen(cloud)).toBe(true);
  });

  it('accepts a context already built with defineBusinessContext', () => {
    const businessContext = defineBusinessContext({ summary: 'Shop' });
    expect(defineCloudPublication({ deployment, businessContext }).businessContext)
      .toEqual(businessContext);
  });

  it('omits business context when none is given', () => {
    expect('businessContext' in defineCloudPublication({ deployment })).toBe(false);
  });

  it('rejects a missing or non-Cloud deployment', () => {
    expect(() => defineCloudPublication({} as never)).toThrow('publishToCloud');
    expect(() => defineCloudPublication({ deployment: { kind: 'serve-api' } as never }))
      .toThrow('publishToCloud');
  });
});
