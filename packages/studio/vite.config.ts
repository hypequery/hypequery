import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

// Relative assets let the same build run below any local or Cloud mount path.
// The host injects the gateway API base separately at runtime.
export default defineConfig(({ command }) => ({
  base: './',
  plugins: [
    react(),
    ...(command === 'serve'
      ? [{
          name: 'studio-local-gateway-config',
          transformIndexHtml: () => [{
            tag: 'script',
            children: 'window.__HYPEQUERY_STUDIO_CONFIG__={gatewayBaseUrl:"/__dev"}',
            injectTo: 'head-prepend' as const,
          }],
        }]
      : []),
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    port: 3001,
    proxy: {
      // In `studio` dev mode, proxy gateway API calls to a running `hypequery dev`
      // (serveDev defaults to port 4000).
      '/__dev/meta': { target: 'http://localhost:4000', changeOrigin: true },
      '/__dev/registry': { target: 'http://localhost:4000', changeOrigin: true },
      '/__dev/execute': { target: 'http://localhost:4000', changeOrigin: true },
      '/__dev/history': { target: 'http://localhost:4000', changeOrigin: true },
      '/__dev/events': { target: 'http://localhost:4000', changeOrigin: true },
      '/__dev/cache': { target: 'http://localhost:4000', changeOrigin: true },
    },
  },
  build: {
    outDir: 'dist',
    // No sourcemaps in the shipped dist — this package rides in the CLI
    // dependency tree (Prisma delivery model), so tarball size matters.
    sourcemap: false,
    rollupOptions: {
      output: {
        // Split the heavy SQL-formatting/highlighting libs into their own
        // chunk so they can load lazily on first SQL view.
        manualChunks: {
          sql: ['prismjs', 'sql-formatter'],
        },
      },
    },
  },
}));
