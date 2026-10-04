export const DATASET_EXAMPLES = {
  typescript: `import { dataset, dimension, measure } from '@hypequery/datasets';
import { analytics } from './client';

export const orders = dataset('orders', {
  source: 'orders',
  dimensions: { country: dimension.string() },
  measures: { revenue: measure.sum('amount') },
});

const result = await analytics.execute(orders, {
  dimensions: ['country'],
  measures: ['revenue'],
});`,
  python: `from hypequery.datasets import Dataset, dimension, measure, sum
from .client import analytics

orders = Dataset(
    name="orders", source="orders",
    dimensions={"country": dimension("string")},
    measures={"revenue": measure(sum("amount"))},
)

result = analytics.execute(orders, {
    "dimensions": ["country"],
    "measures": ["revenue"],
})`,
} as const;

export const BACKEND_EXAMPLES = {
  typescript: `import { app } from '../app';
import { analytics } from '../analytics/client';
import { orders } from '../analytics/orders';

app.get('/analytics/revenue', async (c) => {
  const result = await analytics.execute(orders, {
    dimensions: ['country'], measures: ['revenue'],
  });
  return c.json(result.data);
});`,
  python: `from ..app import app
from ..analytics.client import analytics
from ..analytics.orders import orders

@app.get("/analytics/revenue")
def revenue_by_country():
    result = analytics.execute(orders, {
        "dimensions": ["country"], "measures": ["revenue"],
    })
    return result.data`,
} as const;

export const CLOUD_EXAMPLES = {
  typescript: `import { publishToCloud } from '@hypequery/datasets';
import { orders } from './orders';

export const cloud = publishToCloud({
  datasets: { orders },
  access: { roles: ['analyst'], scopes: [] },
});`,
  python: `from hypequery.datasets import (
    create_dataset_registry, write_dataset_bundle,
)
from .orders import orders

write_dataset_bundle(
    "analytics/hypequery-deployment",
    create_dataset_registry(orders),
    endpoints={"orders": {
        "access": {
            "kind": "authenticated",
            "roles": ["analyst"], "scopes": [],
        },
        "tenant": {"kind": "not-required"},
        "path": "/api/analytics/datasets/orders/query",
    }},
)`,
} as const;

export const CLOUD_COMMANDS = {
  typescript: `hypequery login
hypequery deploy analytics/cloud.ts`,
  python: `python -m analytics.cloud
hypequery login
bundle=analytics/hypequery-deployment
hypequery deployment:release "$bundle"
hypequery deployment:submit "$bundle" \\
  --release "$bundle.release.json"`,
} as const;
