# hypequery + Vite Starter

A minimal Vite + React application with hypequery API server.

## Getting Started

1. Install dependencies:

```bash
npm install
# or
pnpm install
```

2. Run both servers (Vite + hypequery):

```bash
npm run dev:all
# or
pnpm dev:all
```

This starts:
- Vite dev server on [http://localhost:5173](http://localhost:5173)
- hypequery API server on [http://localhost:4000](http://localhost:4000)

3. Open [http://localhost:5173](http://localhost:5173) in your browser.

## Running Servers Separately

You can also run the servers in separate terminals:

```bash
# Terminal 1 - Vite frontend
npm run dev

# Terminal 2 - hypequery API
npm run api
```

## Project Structure

```
├── api/
│   └── queries.ts                # hypequery API definitions
├── src/
│   ├── App.tsx                   # Main React component
│   ├── main.tsx                  # React entry point
│   ├── App.css
│   └── index.css
├── vite.config.ts                # Vite config with proxy
├── package.json
└── tsconfig.json
```

## How It Works

- The **Vite dev server** runs on port 5173
- The **hypequery API server** runs on port 4000 (standalone)
- Vite's **proxy** forwards `/api/*` requests to the hypequery server
- This avoids CORS issues during development

### Proxy Configuration

See `vite.config.ts`:

```typescript
server: {
  proxy: {
    '/api': {
      target: 'http://localhost:4000',
      changeOrigin: true,
      rewrite: (path) => path.replace(/^\/api/, ''),
    },
  },
}
```

Requests to `/api/hello` → `http://localhost:4000/hello`

## Adding Queries

Edit `api/queries.ts`:

```typescript
export const api = define({
  queries: queries({
    myQuery: query
      .output(z.object({ data: z.string() }))
      .query(async () => ({ data: 'Hello!' })),
  }),
});

// Register the route
api.route('/myQuery', api.queries.myQuery, { method: 'GET' });
```

The hypequery server will automatically reload when you save changes.

## Learn More

- [hypequery Documentation](https://hypequery.com/docs)
- [Vite Documentation](https://vite.dev)
