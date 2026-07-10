import type { IncomingMessage, ServerResponse } from 'http';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import * as path from 'node:path';
import { DevAPIRouter, type RouterOptions } from './api/router.js';

/**
 * Options for creating the dev handler.
 */
export interface DevHandlerOptions extends RouterOptions {
  /** Base path for internal UI assets and APIs (default: /__dev) */
  apiBasePath?: string;
}

const CONTENT_TYPES: Record<string, string> = {
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.png': 'image/png',
  '.ico': 'image/x-icon'
};

/**
 * Locate the built @hypequery/studio dist directory on disk. Returns null when
 * the studio package is not installed (gateway then runs API-only).
 */
function resolveStudioDist(): string | null {
  try {
    const require = createRequire(import.meta.url);
    const pkgJson = require.resolve('@hypequery/studio/package.json');
    return path.join(path.dirname(pkgJson), 'dist');
  } catch {
    return null;
  }
}

/**
 * Dev handler: serves the studio UI same-origin under /__dev and routes
 * /__dev/* API requests. UI assets are read from the installed
 * @hypequery/studio package on disk (no build-time embedding).
 */
export class DevHandler {
  private router: DevAPIRouter;
  private apiBasePath: string;
  private distDir: string | null;

  constructor(options: DevHandlerOptions) {
    this.apiBasePath = options.apiBasePath ?? '/__dev';
    this.distDir = resolveStudioDist();
    this.router = new DevAPIRouter(options);
  }

  /** Whether the studio UI is available on disk. */
  get uiAvailable(): boolean {
    return this.distDir !== null;
  }

  /**
   * Handle an incoming HTTP request.
   * @returns true if the request was handled, false otherwise
   */
  async handleRequest(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
    const url = req.url || '';
    const reqPath = url.split('?')[0];

    // Static assets under the base path (must precede the generic API match)
    if (reqPath.startsWith(`${this.apiBasePath}/assets/`)) {
      const assetPath = reqPath.slice(`${this.apiBasePath}/`.length);
      return this.serveAsset(res, assetPath);
    }

    // API routes
    if (reqPath.startsWith(`${this.apiBasePath}/`)) {
      return this.router.handleRequest(req, res);
    }

    // The UI shell at the base path
    if (reqPath === this.apiBasePath || reqPath === `${this.apiBasePath}/`) {
      return this.serveHTML(res);
    }

    return false;
  }

  private async serveHTML(res: ServerResponse): Promise<boolean> {
    if (!this.distDir) {
      res.writeHead(503, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('hypequery studio UI is not installed. Install @hypequery/studio to enable the playground.');
      return true;
    }
    try {
      const html = await readFile(path.join(this.distDir, 'index.html'), 'utf-8');
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache' });
      res.end(html);
    } catch {
      res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Failed to load studio UI');
    }
    return true;
  }

  private async serveAsset(res: ServerResponse, assetPath: string): Promise<boolean> {
    if (!this.distDir) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Not found');
      return true;
    }

    // Prevent path traversal: resolve and confirm the target stays within dist
    const resolved = path.resolve(this.distDir, assetPath);
    const distRoot = path.resolve(this.distDir);
    if (resolved !== distRoot && !resolved.startsWith(distRoot + path.sep)) {
      res.writeHead(403, { 'Content-Type': 'text/plain' });
      res.end('Forbidden');
      return true;
    }

    try {
      const data = await readFile(resolved);
      const type = CONTENT_TYPES[path.extname(resolved)] ?? 'application/octet-stream';
      res.writeHead(200, {
        'Content-Type': type,
        'Cache-Control': 'public, max-age=31536000, immutable'
      });
      res.end(data);
    } catch {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Not found');
    }
    return true;
  }

  getSSEHandler() {
    return this.router.getSSEHandler();
  }

  getClientCount(): number {
    return this.router.getClientCount();
  }

  shutdown(): void {
    this.router.shutdown();
  }
}

export function createDevHandler(options: DevHandlerOptions): DevHandler {
  return new DevHandler(options);
}
