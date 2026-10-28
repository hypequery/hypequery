"""The development docs page: Redoc over the API's OpenAPI document, as in TypeScript."""

from __future__ import annotations

import html

_REDOC = "https://cdn.jsdelivr.net/npm/redoc@2/bundles/redoc.standalone.js"


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
    <script src="{_REDOC}"></script>
  </body>
</html>
"""
