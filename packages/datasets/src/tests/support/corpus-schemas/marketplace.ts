/**
 * Customer-shaped schema 2: a multi-tenant commerce platform, one customer.
 *
 * Modelled on a single hypequery customer that hosts many merchants in shared
 * tables and serves each merchant its own analytics: every table carries
 * `merchant_id`, line items join to buyers and products, and gross
 * merchandise value is computed from quantity and unit price rather than
 * stored. This is the cross-tenant shape: every query is predicate-scoped to a
 * merchant, including through joins.
 *
 * ClickHouse DDL this mirrors:
 *
 *   CREATE TABLE shop.line_items (
 *     merchant_id String, order_id UUID, ordered_at DateTime,
 *     buyer_id UInt64, sku String, quantity UInt32,
 *     unit_price Decimal(12, 2), discount Decimal(12, 2),
 *     currency LowCardinality(String), fulfilment_status LowCardinality(String),
 *     sales_channel LowCardinality(String)
 *   ) ENGINE = MergeTree ORDER BY (merchant_id, ordered_at);
 *
 *   CREATE TABLE shop.buyers (
 *     merchant_id String, buyer_id UInt64, segment LowCardinality(String),
 *     country_code FixedString(2), first_order_at DateTime
 *   ) ENGINE = ReplacingMergeTree ORDER BY (merchant_id, buyer_id);
 *
 *   CREATE TABLE shop.products (
 *     merchant_id String, sku String, brand String,
 *     category LowCardinality(String)
 *   ) ENGINE = ReplacingMergeTree ORDER BY (merchant_id, sku);
 */

import { dataset } from '../../../dataset.js';
import { dimension } from '../../../field.js';
import { coalesce, divide, nullIfZero, round, subtract } from '../../../formulas.js';
import { measure } from '../../../measure.js';
import { eq } from '../../../query-helpers.js';
import { belongsTo } from '../../../relationships.js';
import type { MetricHandle, TimeGrain } from '../../../types.js';

export const Buyers = dataset('buyers', {
  source: 'shop.buyers',
  tenantKey: 'merchant_id',
  dimensions: {
    id: dimension.number({ column: 'buyer_id' }),
    segment: dimension.string(),
    country: dimension.string({ column: 'country_code' }),
    firstOrderAt: dimension.timestamp({ column: 'first_order_at' }),
  },
});

export const Products = dataset('products', {
  source: 'shop.products',
  tenantKey: 'merchant_id',
  dimensions: {
    sku: dimension.string(),
    brand: dimension.string(),
    category: dimension.string(),
  },
});

export const LineItems = dataset('lineItems', {
  source: 'shop.line_items',
  tenantKey: 'merchant_id',
  timeKey: 'orderedAt',
  dimensions: {
    orderedAt: dimension.timestamp({ column: 'ordered_at' }),
    orderId: dimension.string({ column: 'order_id', groupable: false }),
    buyerId: dimension.number({ column: 'buyer_id' }),
    sku: dimension.string(),
    currency: dimension.string(),
    fulfilment: dimension.string({ column: 'fulfilment_status' }),
    channel: dimension.string({ column: 'sales_channel' }),
    quantity: dimension.number({ groupable: false }),
    unitPrice: dimension.number({ column: 'unit_price', groupable: false }),
    discount: dimension.number({ groupable: false }),
    lineTotal: dimension.number({
      sql: 'quantity * unit_price',
      dependencies: ['quantity', 'unit_price'],
      groupable: false,
    }),
  },
  measures: {
    gmv: measure.sum('lineTotal'),
    units: measure.sum('quantity'),
    orders: measure.countDistinct('orderId'),
    buyers: measure.countDistinct('buyerId'),
    discounts: measure.sum('discount'),
    avgUnitPrice: measure.avg('unitPrice'),
    cheapestUnit: measure.min('unitPrice'),
    refundedGmv: measure.sum('lineTotal', { filters: [eq('fulfilment', 'refunded')] }),
    topSku: measure.argMax('sku', 'quantity'),
    unitsPerOrder: measure.derived({
      uses: { units: 'units', orders: 'orders' },
      formula: ({ units, orders }) => divide(units, nullIfZero(orders)),
    }),
  },
  filters: {
    fulfilment: { __type: 'filter_definition', field: 'fulfilment', operators: ['eq', 'neq', 'in'] },
    channel: { __type: 'filter_definition', field: 'channel', operators: ['eq', 'notIn'] },
    currency: { __type: 'filter_definition', field: 'currency', operators: ['eq'] },
    orderedAt: { __type: 'filter_definition', field: 'orderedAt', operators: ['gt', 'lte', 'between'] },
  },
  relationships: {
    buyer: belongsTo(() => Buyers, { from: 'buyer_id', to: 'buyer_id' }),
    product: belongsTo(() => Products, { from: 'sku', to: 'sku' }),
  },
  limits: { maxDimensions: 6, maxMeasures: 6, maxFilters: 5, maxResultSize: 5_000 },
});

const gmvInput = LineItems.metric('gmv', { measure: 'gmv' });
const ordersInput = LineItems.metric('orders', { measure: 'orders' });
const discountsInput = LineItems.metric('discounts', { measure: 'discounts' });
const refundedInput = LineItems.metric('refunded', { measure: 'refundedGmv' });

function grained(handle: unknown, grain: TimeGrain): MetricHandle {
  return (handle as { by(grain: TimeGrain): MetricHandle }).by(grain);
}

export const marketplaceMetrics: Record<string, MetricHandle> = {
  gmv: LineItems.metric('gmv', { measure: 'gmv' }) as MetricHandle,
  monthlyGmv: grained(LineItems.metric('monthlyGmv', { measure: 'gmv' }), 'month'),
  averageOrderValue: LineItems.metric('averageOrderValue', {
    uses: { gmv: gmvInput, orders: ordersInput },
    formula: ({ gmv, orders }) => round(divide(gmv, nullIfZero(orders)), 2),
  }) as MetricHandle,
  discountRate: LineItems.metric('discountRate', {
    uses: { discounts: discountsInput, gmv: gmvInput },
    formula: ({ discounts, gmv }) => coalesce(divide(discounts, nullIfZero(gmv)), 0),
  }) as MetricHandle,
  netGmv: LineItems.metric('netGmv', {
    uses: { gmv: gmvInput, refunded: refundedInput },
    formula: ({ gmv, refunded }) => subtract(gmv, refunded),
  }) as MetricHandle,
  weeklyNetGmv: grained(LineItems.metric('weeklyNetGmv', {
    uses: { gmv: gmvInput, refunded: refundedInput },
    formula: ({ gmv, refunded }) => subtract(gmv, refunded),
  }), 'week'),
};
