"""Request identifiers: the server's authoritative id and a caller's correlation id.

The core generates the authoritative id for every request; a handler reads it
as ``call.state.request_id``. A caller's own id is never authoritative; it is
echoed only as `x-correlation-id`, after passing the same grammar and bound as
TypeScript serve (`core/request_ids.py`).
"""

from __future__ import annotations

from .core.request_ids import MAX_CORRELATION_ID_BYTES, sanitize_correlation_id

__all__ = ["MAX_CORRELATION_ID_BYTES", "sanitize_correlation_id"]
