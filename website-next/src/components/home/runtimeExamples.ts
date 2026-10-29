// Code for the "Runs where your app runs" section: one entry per framework.
// TypeScript entries mount the same `api` (serve({ queryBuilder, datasets })) through
// createFetchHandler or createNodeHandler; Python entries mount the same `api` (create_api()
// with dataset endpoints). Checked on 2026-10-28: Express, Fastify and Hono against
// @hypequery/serve 0.23.1, and FastAPI, Django, Flask, Starlette and WSGI against a local
// ClickHouse. The other fetch-based entries hand the framework's Request to the same handler.

export type RuntimeLanguage = 'typescript' | 'python';

export type RuntimeExample = {
  id: string;
  name: string;
  detail: string;
  language: RuntimeLanguage;
  code: string;
};

export const RUNTIME_EXAMPLES: RuntimeExample[] = [
  {
    id: 'nextjs',
    name: 'Next.js',
    detail: 'Route handler',
    language: 'typescript',
    code: `// app/api/analytics/[...path]/route.ts
import { createFetchHandler } from '@hypequery/serve';
import { api } from '@/analytics/api';

const handler = createFetchHandler(api.handler);

export const runtime = 'nodejs';
export const GET = handler;
export const POST = handler;
export const OPTIONS = handler;`,
  },
  {
    id: 'react-router',
    name: 'React Router',
    detail: 'Resource route',
    language: 'typescript',
    code: `// app/routes/api.analytics.$.ts (React Router v7 / Remix)
import { createFetchHandler } from '@hypequery/serve';
import { api } from '~/analytics/api';

const handler = createFetchHandler(api.handler);

export const loader = ({ request }: { request: Request }) => handler(request);
export const action = ({ request }: { request: Request }) => handler(request);`,
  },
  {
    id: 'sveltekit',
    name: 'SvelteKit',
    detail: 'Server route',
    language: 'typescript',
    code: `// src/routes/api/analytics/[...path]/+server.ts
import type { RequestHandler } from './$types';
import { createFetchHandler } from '@hypequery/serve';
import { api } from '$lib/analytics/api';

const handler = createFetchHandler(api.handler);

// fallback answers every method
export const fallback: RequestHandler = ({ request }) => handler(request);`,
  },
  {
    id: 'express',
    name: 'Express',
    detail: 'Beside your routes',
    language: 'typescript',
    code: `// server.ts
import express from 'express';
import { createNodeHandler } from '@hypequery/serve';
import { api } from './analytics/api';

const app = express();

// Register before express.json(): hypequery reads the request body itself.
app.all('/api/analytics/{*path}', createNodeHandler(api.handler));

app.use(express.json());
app.get('/health', (_req, res) => res.send('ok'));

app.listen(3000);`,
  },
  {
    id: 'fastify',
    name: 'Fastify',
    detail: 'Encapsulated plugin',
    language: 'typescript',
    code: `// server.ts
import Fastify from 'fastify';
import { createNodeHandler } from '@hypequery/serve';
import { api } from './analytics/api';

const app = Fastify();
const hypequery = createNodeHandler(api.handler);

app.register(async (scope) => {
  // leave the body stream for hypequery to read
  scope.removeAllContentTypeParsers();
  scope.addContentTypeParser('*', (_req, _body, done) => done(null));
  scope.all('/api/analytics/*', (req, reply) => {
    reply.hijack();
    hypequery(req.raw, reply.raw);
  });
});

await app.listen({ port: 3000 });`,
  },
  {
    id: 'hono',
    name: 'Hono',
    detail: 'Catch-all route',
    language: 'typescript',
    code: `// app.ts
import { Hono } from 'hono';
import { createFetchHandler } from '@hypequery/serve';
import { api } from './analytics/api';

const app = new Hono();
const hypequery = createFetchHandler(api.handler);

app.all('/api/analytics/*', (c) => hypequery(c.req.raw));

export default app;`,
  },
  {
    id: 'workers',
    name: 'Cloudflare Workers',
    detail: 'Fetch handler',
    language: 'typescript',
    code: `// src/worker.ts
import { createFetchHandler } from '@hypequery/serve';
import { api } from './analytics/api';

export default {
  fetch: createFetchHandler(api.handler),
};`,
  },
  {
    id: 'bun-deno',
    name: 'Bun and Deno',
    detail: 'Built-in servers',
    language: 'typescript',
    code: `import { createFetchHandler } from '@hypequery/serve';
import { api } from './analytics/api';

const handler = createFetchHandler(api.handler);

// Bun
Bun.serve({ port: 3000, fetch: handler });

// Deno
Deno.serve({ port: 3000 }, handler);`,
  },
  {
    id: 'node-jobs',
    name: 'Node jobs',
    detail: 'In-process, no HTTP',
    language: 'typescript',
    code: `// jobs/weekly-report.ts
import { createDatasetClient } from '@hypequery/datasets';
import { db } from '../analytics/client';
import { Orders } from '../analytics/datasets';

const analytics = createDatasetClient({ queryBuilder: db });

const { data } = await analytics.execute(
  Orders,
  { dimensions: ['country'], measures: ['revenue'] },
  { runtime: { tenant: { id: orgId } } },
);`,
  },
  {
    id: 'fastapi',
    name: 'FastAPI',
    detail: 'Mounted ASGI app',
    language: 'python',
    code: `# main.py
from fastapi import FastAPI
from hypequery.serve import to_asgi_app

from analytics.api import api  # create_api() + add_dataset_endpoint()

app = FastAPI()


@app.get("/health")
def health():
    return {"ok": True}


app.mount("/api/analytics", to_asgi_app(api))`,
  },
  {
    id: 'django',
    name: 'Django',
    detail: 'URLconf, sync or async',
    language: 'python',
    code: `# project/urls.py
from django.urls import include, path
from hypequery.contrib.django import urls

from analytics.api import api  # create_api() + add_dataset_endpoint()

from . import views

urlpatterns = [
    path("reports/", views.reports),
    path("api/analytics/", include(urls(api))),
]`,
  },
  {
    id: 'flask',
    name: 'Flask',
    detail: 'Blueprint',
    language: 'python',
    code: `# app.py
from flask import Flask
from hypequery.contrib.flask import blueprint

from analytics.api import api  # create_api() + add_dataset_endpoint()

app = Flask(__name__)


@app.get("/health")
def health():
    return {"ok": True}


app.register_blueprint(blueprint(api), url_prefix="/api/analytics")`,
  },
  {
    id: 'starlette',
    name: 'Starlette',
    detail: 'Mount',
    language: 'python',
    code: `# app.py
from starlette.applications import Starlette
from starlette.routing import Mount, Route
from hypequery.serve import to_asgi_app

from analytics.api import api  # create_api() + add_dataset_endpoint()

app = Starlette(routes=[
    Route("/", homepage),
    Mount("/api/analytics", app=to_asgi_app(api)),
])`,
  },
  {
    id: 'servers',
    name: 'Uvicorn, Gunicorn',
    detail: 'Any ASGI or WSGI server',
    language: 'python',
    code: `# analytics/server.py
from hypequery.serve import to_asgi_app, to_wsgi_app

from analytics.api import api  # create_api() + add_dataset_endpoint()

asgi = to_asgi_app(api)  # uvicorn analytics.server:asgi
wsgi = to_wsgi_app(api)  # gunicorn analytics.server:wsgi`,
  },
  {
    id: 'notebooks',
    name: 'Notebooks and jobs',
    detail: 'Straight into pandas',
    language: 'python',
    code: `# a notebook cell, a Celery task, or a script
from hypequery.datasets import tenant

from analytics.client import analytics  # create_dataset_client(...)

df = (
    analytics.for_tenant(tenant("org_123"))
    .execute("orders", {"measures": ["revenue"], "by": "month"})
    .to_pandas()
)`,
  },
];
