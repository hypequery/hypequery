"""The HTTP security profile: trusted hosts, proxy trust and CORS.

`HttpSecurity` is a validated configuration object. A configuration that could
not be safe, such as credentialed CORS for any origin, fails when it is built,
not on the first request. Pass it as ``create_api(security=...)``; `Api.handle`
applies it to every request, outermost first (`core/security.py`).
"""

from __future__ import annotations

from .core.security import CorsPolicy, HttpSecurity

__all__ = ["CorsPolicy", "HttpSecurity"]
