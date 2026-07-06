import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

// The studio is served same-origin by the local gateway under /__dev, so built
// asset URLs must be prefixed accordingly. The gateway serves the HTML shell at
// /__dev and static assets at /__dev/assets/*.
export default defineConfig({
  base: '/__dev/',
  plugins: [react()],
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
    sourcemap: true,
  },
});
