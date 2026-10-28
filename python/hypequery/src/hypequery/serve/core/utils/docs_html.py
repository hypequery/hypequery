"""The development docs page: Redoc over the API's OpenAPI document, as in TypeScript.

The page loads one third-party script, so it is pinned: an exact Redoc release,
checked by Subresource Integrity, so a changed or compromised CDN file is
refused rather than run with the page's origin. `DOCS_POLICY` lets the page do
only what Redoc needs.
"""

from __future__ import annotations

import html

REDOC_VERSION = "2.5.4"
REDOC_URL = f"https://cdn.jsdelivr.net/npm/redoc@{REDOC_VERSION}/bundles/redoc.standalone.js"
#: jsDelivr's SHA-256 of `REDOC_URL`; a new release needs its new digest.
REDOC_INTEGRITY = "sha256-3K92YSvEo/vMkjqJZt7i9hRqXzLlzhtvAt1gy7+JUAs="

#: The docs page's Content-Security-Policy: the pinned script, Redoc's inline
#: styles and search worker, the document from the page's own origin, and
#: nothing else. No page may frame it.
DOCS_POLICY = "; ".join(
    (
        "default-src 'none'",
        f"script-src {REDOC_URL}",
        "style-src 'unsafe-inline'",
        # Redoc's "API docs by Redocly" badge.
        "img-src data: https://cdn.redoc.ly/redoc/logo-mini.svg",
        "font-src data:",
        "connect-src 'self'",
        "worker-src blob:",
        "base-uri 'none'",
        "form-action 'none'",
        "frame-ancestors 'none'",
    )
)


def docs_html(openapi_url: str, title: str) -> str:
    """A page rendering the document at *openapi_url*, relative to the page."""

    return f"""<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>{html.escape(title)}</title>
    <style>body {{ margin: 0; padding: 0; }}</style>
  </head>
  <body>
    <redoc spec-url="{html.escape(openapi_url, quote=True)}"></redoc>
    <script src="{REDOC_URL}" integrity="{REDOC_INTEGRITY}" crossorigin="anonymous"></script>
  </body>
</html>
"""
