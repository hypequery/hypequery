"""Reference implementation of the Hypequery security protocol.

The normative rules live in ``specs/security-protocol/`` at the repository
root; this package implements them and is proven against the shared fixtures
by the conformance runner. It must never depend on a web framework, a database
driver, or the ``datasets``/``serve`` layers above it.

Populated by PYA-03 (tagged values, RFC 8785 canonical JSON) and PYA-04
(portable identifiers).
"""

from __future__ import annotations

__all__: list[str] = []
