import { dataset, dimension, measure } from '../semantic/index.js';
import { createAPI, initServe, type ClientContractConfig, type HypeQueryAPI } from '../index.js';
import type { Equal, Expect } from '@type-challenges/utils';
import type { QueryBuilderFactoryLike } from '@hypequery/datasets';
import type { PreparedProtocolClientContract, ProtocolClientContract } from '@hypequery/protocol';

declare const queryBuilder: QueryBuilderFactoryLike;
const Orders = dataset('orders', {
  source: 'orders',
  dimensions: { country: dimension.string() },
  measures: { revenue: measure.sum('amount') },
});

const api = createAPI({ queryBuilder, datasets: { orders: Orders }, clientContract: { mountPath: '/edge' } });
export const exported = api.clientContract();
export type _Exported = Expect<Equal<typeof exported, PreparedProtocolClientContract>>;
export type _Contract = Expect<Equal<typeof exported.contract, ProtocolClientContract>>;
export type _Canonical = Expect<Equal<typeof exported.canonical, string>>;
export type _Method = Expect<Equal<HypeQueryAPI['clientContract'], () => PreparedProtocolClientContract>>;
export type _Config = Expect<Equal<ClientContractConfig, { mountPath?: string }>>;

// initServe's API exports the same contract.
const { serve } = initServe({ queryBuilder });
export const fromInitServe: PreparedProtocolClientContract = serve({ datasets: { orders: Orders } }).clientContract();

// @ts-expect-error The mount path is a string.
createAPI({ queryBuilder, datasets: { orders: Orders }, clientContract: { mountPath: 1 } });
