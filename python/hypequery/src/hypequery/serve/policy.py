"""Server-authored endpoint policy, never deserialized from a request."""

from __future__ import annotations

from .core.policy import DEFAULT_ENDPOINT_POLICY, EndpointPolicy

__all__ = ["DEFAULT_ENDPOINT_POLICY", "EndpointPolicy"]
