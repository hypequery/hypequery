"""The headers every response from the core carries, whatever answered it.

An API answers JSON (and the odd `text/plain` refusal) to programs, never a
page to render. Two headers keep a browser from treating an answer as one:

- `X-Content-Type-Options: nosniff`, so a JSON body is never sniffed into
  HTML or script, and a cross-site `<script src>` of an endpoint is blocked;
- `Content-Security-Policy: default-src 'none'; frame-ancestors 'none'`, so a
  response opened as a document runs nothing, loads nothing and cannot be
  framed. A route that serves a page (the development docs) sets its own.

`Cache-Control: no-store` is not here: it belongs to authenticated and error
responses (`api.py`, `errors.py`), and a public route may choose to be cached.
"""

from __future__ import annotations

from ..messages import ServeResponse

NOSNIFF = "nosniff"
#: For a response that is not a page: nothing may run, load or frame it.
NO_DOCUMENT_POLICY = "default-src 'none'; frame-ancestors 'none'"


def with_security_headers(response: ServeResponse) -> ServeResponse:
    """*response* with the baseline headers; a route's own policy is kept."""

    headers = {"x-content-type-options": NOSNIFF}
    if not any(name.lower() == "content-security-policy" for name in response.headers):
        headers["content-security-policy"] = NO_DOCUMENT_POLICY
    return response.with_headers(headers)
