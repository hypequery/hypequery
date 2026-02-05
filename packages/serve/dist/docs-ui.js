const REDOC_CDN = "https://cdn.jsdelivr.net/npm/redoc@latest/bundles/redoc.standalone.js";
const sanitize = (value, fallback = "") => (value ?? fallback).replace(/</g, "&lt;").replace(/>/g, "&gt;");
export const buildDocsHtml = (openapiUrl, options) => {
    const title = sanitize(options?.title, "hypequery");
    const subtitle = sanitize(options?.subtitle);
    const darkClass = options?.darkMode ? "hq-docs--dark" : "";
    return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${title}</title>
    <style>
      body, html { margin: 0; padding: 0; height: 100%; font-family: Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; }
      .hq-docs { display: flex; flex-direction: column; height: 100%; }
      .hq-docs__header { padding: 1.25rem 1.5rem; border-bottom: 1px solid rgba(0,0,0,0.08); }
      .hq-docs--dark .hq-docs__header { border-color: rgba(255,255,255,0.12); }
      .hq-docs__title { margin: 0; font-size: 1.25rem; }
      .hq-docs__subtitle { margin: 0.25rem 0 0; color: #555; }
      .hq-docs--dark { background: #0f1115; color: #f8f8f2; }
      .hq-docs--dark .hq-docs__subtitle { color: #b4b6c2; }
      redoc { flex: 1; }
    </style>
  </head>
  <body class="hq-docs ${darkClass}">
    <header class="hq-docs__header">
      <h1 class="hq-docs__title">${title}</h1>
      ${subtitle ? `<p class="hq-docs__subtitle">${subtitle}</p>` : ""}
    </header>
    <redoc spec-url="${openapiUrl}"></redoc>
    <script src="${REDOC_CDN}"></script>
  </body>
</html>`;
};
