// The frameworks in the "Runs where your app runs" section, each linking to its docs.

export type RuntimeLanguage = 'typescript' | 'python';

export type RuntimeExample = {
  id: string;
  name: string;
  detail: string;
  language: RuntimeLanguage;
  /** The docs page, or section, showing how to mount hypequery in this framework. */
  href: string;
};

export const RUNTIME_EXAMPLES: RuntimeExample[] = [
  {
    id: 'nextjs',
    href: '/docs/nextjs',
    name: 'Next.js',
    detail: 'Route handler',
    language: 'typescript',
  },
  {
    id: 'react-router',
    href: '/docs/fetch#react-router',
    name: 'React Router',
    detail: 'Resource route',
    language: 'typescript',
  },
  {
    id: 'sveltekit',
    href: '/docs/fetch#sveltekit',
    name: 'SvelteKit',
    detail: 'Server route',
    language: 'typescript',
  },
  {
    id: 'express',
    href: '/docs/nodejs#express',
    name: 'Express',
    detail: 'Beside your routes',
    language: 'typescript',
  },
  {
    id: 'fastify',
    href: '/docs/nodejs#fastify',
    name: 'Fastify',
    detail: 'Encapsulated plugin',
    language: 'typescript',
  },
  {
    id: 'hono',
    href: '/docs/fetch#hono',
    name: 'Hono',
    detail: 'Catch-all route',
    language: 'typescript',
  },
  {
    id: 'workers',
    href: '/docs/fetch#cloudflare-workers',
    name: 'Cloudflare Workers',
    detail: 'Fetch handler',
    language: 'typescript',
  },
  {
    id: 'bun-deno',
    href: '/docs/fetch#bun-and-deno',
    name: 'Bun and Deno',
    detail: 'Built-in servers',
    language: 'typescript',
  },
  {
    id: 'node-jobs',
    href: '/docs/embedded-runtime',
    name: 'Node jobs',
    detail: 'In-process, no HTTP',
    language: 'typescript',
  },
  {
    id: 'fastapi',
    href: '/docs/python/fastapi',
    name: 'FastAPI',
    detail: 'Mounted ASGI app',
    language: 'python',
  },
  {
    id: 'django',
    href: '/docs/python/django',
    name: 'Django',
    detail: 'URLconf, sync or async',
    language: 'python',
  },
  {
    id: 'flask',
    href: '/docs/python/flask',
    name: 'Flask',
    detail: 'Blueprint',
    language: 'python',
  },
  {
    id: 'starlette',
    href: '/docs/python/serving#mount-in-any-asgi-or-wsgi-app',
    name: 'Starlette',
    detail: 'Mount',
    language: 'python',
  },
  {
    id: 'servers',
    href: '/docs/python/serving#mount-in-any-asgi-or-wsgi-app',
    name: 'Uvicorn, Gunicorn',
    detail: 'Any ASGI or WSGI server',
    language: 'python',
  },
  {
    id: 'notebooks',
    href: '/docs/python/dataframes',
    name: 'Notebooks and jobs',
    detail: 'Straight into pandas',
    language: 'python',
  },
];
