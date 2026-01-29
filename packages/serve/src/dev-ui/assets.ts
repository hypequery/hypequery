import { EMBEDDED_HTML, EMBEDDED_JS, EMBEDDED_CSS } from './embedded-assets.js';

/**
 * Assets for the dev UI.
 */
export interface DevUIAssets {
  html: string;
  js: Record<string, string>;
  css: Record<string, string>;
}

/**
 * Get the dev UI assets.
 * Uses embedded assets that are baked in at build time.
 */
export function getDevUIAssets(): DevUIAssets {
  if (EMBEDDED_HTML) {
    return {
      html: EMBEDDED_HTML,
      js: EMBEDDED_JS,
      css: EMBEDDED_CSS,
    };
  }

  return {
    html: getFallbackHTML(),
    js: {},
    css: {},
  };
}

/**
 * Check if the dev UI is available (embedded).
 */
export function isDevUIAvailable(): boolean {
  return EMBEDDED_HTML !== null;
}

/**
 * Clear the asset cache (no-op, kept for API compatibility).
 */
export function clearAssetCache(): void {
  // Assets are embedded at build time, no cache to clear
}

/**
 * Fallback HTML when UI assets are not embedded.
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
    <h1>Dev Tools UI Not Available</h1>
    <p>
      The dev tools UI assets were not embedded during the build.
      Please rebuild the <code>@hypequery/serve</code> package.
    </p>
  </div>
</body>
</html>`;
}
