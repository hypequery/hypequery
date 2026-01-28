import { readFileSync, readdirSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

/**
 * Assets for the dev UI.
 */
export interface DevUIAssets {
  html: string;
  js: Record<string, string>;
  css: Record<string, string>;
  maps?: Record<string, string>;
}

// Cache for assets
let cachedAssets: DevUIAssets | null = null;

/**
 * Find the serve-ui dist directory.
 */
function findServeUIDistDir(): string | null {
  // Try relative paths from this file's location
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = dirname(__filename);

  const possiblePaths = [
    // From compiled serve/dist/dev-ui/
    join(__dirname, '../../../../serve-ui/dist'),
    // From serve/src/dev-ui/
    join(__dirname, '../../../serve-ui/dist'),
    // From monorepo root
    join(__dirname, '../../../../../../packages/serve-ui/dist'),
    // Fallback: look for serve-ui in node_modules
    join(__dirname, '../../../node_modules/@hypequery/serve-ui/dist')
  ];

  for (const p of possiblePaths) {
    if (existsSync(p)) {
      return p;
    }
  }

  return null;
}

/**
 * Generate fallback HTML when serve-ui is not built.
 */
function getFallbackHTML(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>HypeQuery Dev Tools</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: system-ui, -apple-system, sans-serif;
      background: #0a0a0a;
      color: #fafafa;
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .container {
      text-align: center;
      padding: 2rem;
      max-width: 500px;
    }
    h1 { font-size: 1.5rem; margin-bottom: 1rem; }
    p { color: #a1a1aa; margin-bottom: 1.5rem; line-height: 1.6; }
    code {
      background: #27272a;
      padding: 0.125rem 0.375rem;
      border-radius: 0.25rem;
      font-size: 0.875rem;
    }
    pre {
      background: #18181b;
      border: 1px solid #27272a;
      border-radius: 0.5rem;
      padding: 1rem;
      text-align: left;
      overflow-x: auto;
      margin-top: 1rem;
    }
    pre code {
      background: none;
      padding: 0;
    }
  </style>
</head>
<body>
  <div class="container">
    <h1>Dev Tools Not Built</h1>
    <p>
      The dev tools UI needs to be built first. Run the following command:
    </p>
    <pre><code>pnpm --filter @hypequery/serve-ui build</code></pre>
    <p style="margin-top: 1.5rem; font-size: 0.875rem;">
      Then restart the dev server.
    </p>
  </div>
</body>
</html>`;
}

/**
 * Load assets from the serve-ui dist directory.
 */
function loadAssets(): DevUIAssets {
  const distDir = findServeUIDistDir();

  if (!distDir) {
    return {
      html: getFallbackHTML(),
      js: {},
      css: {}
    };
  }

  try {
    // Read index.html
    const htmlPath = join(distDir, 'index.html');
    let html = existsSync(htmlPath)
      ? readFileSync(htmlPath, 'utf-8')
      : getFallbackHTML();

    // Rewrite asset paths to use /__dev/assets/
    html = html.replace(/\/assets\//g, '/__dev/assets/');

    // Read JS and CSS files from assets directory
    const assetsDir = join(distDir, 'assets');
    const js: Record<string, string> = {};
    const css: Record<string, string> = {};
    const maps: Record<string, string> = {};

    if (existsSync(assetsDir)) {
      const files = readdirSync(assetsDir);

      for (const file of files) {
        const filePath = join(assetsDir, file);

        if (file.endsWith('.js')) {
          js[file] = readFileSync(filePath, 'utf-8');
        } else if (file.endsWith('.css')) {
          css[file] = readFileSync(filePath, 'utf-8');
        } else if (file.endsWith('.js.map')) {
          maps[file] = readFileSync(filePath, 'utf-8');
        }
      }
    }

    return { html, js, css, maps };
  } catch (error) {
    console.error('[DevUI] Failed to load assets:', error);
    return {
      html: getFallbackHTML(),
      js: {},
      css: {}
    };
  }
}

/**
 * Get the dev UI assets.
 * Assets are cached after first load.
 */
export function getDevUIAssets(): DevUIAssets {
  if (!cachedAssets) {
    cachedAssets = loadAssets();
  }
  return cachedAssets;
}

/**
 * Clear the asset cache.
 * Useful for development when rebuilding the UI.
 */
export function clearAssetCache(): void {
  cachedAssets = null;
}

/**
 * Check if the dev UI is available (built).
 */
export function isDevUIAvailable(): boolean {
  const distDir = findServeUIDistDir();
  return distDir !== null && existsSync(join(distDir, 'index.html'));
}
