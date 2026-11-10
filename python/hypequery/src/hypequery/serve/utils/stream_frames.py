"""The body of a streamed dataset response: NDJSON frames, or an Arrow IPC stream.

NDJSON, one JSON object per line, matches TypeScript serve frame for frame:

    {"type":"start","meta":{...}}       meta only when requested
    {"type":"rows","data":[...]}        one per non-empty batch, the rows a page holds
    {"type":"end","rowCount":N}         the result is complete
    {"type":"error","error":{...}}      the query failed after the response began

A failure partway is a final ``error`` frame, so a body without ``end`` is
incomplete. Error frames never carry the driver's or the database's text.
"""

from __future__ import annotations

import io
from typing import TYPE_CHECKING, Final

from ..core.utils.json_body import render_json

if TYPE_CHECKING:
    import pyarrow as pa

QUERY_FAILED: Final = "The query failed after the response began."


def frame(value: object) -> bytes:
    return render_json(value) + b"\n"


def error_frame(kind: str, message: str) -> bytes:
    return frame({"type": "error", "error": {"type": kind, "message": message}})


class _Chunks(io.RawIOBase):
    """A sink that hands back what was written since it was last drained."""

    def __init__(self) -> None:
        self._parts: list[bytes] = []

    def writable(self) -> bool:
        return True

    def write(self, data: object) -> int:
        chunk = bytes(data)  # type: ignore[call-overload]
        self._parts.append(chunk)
        return len(chunk)

    def drain(self) -> bytes:
        parts, self._parts = self._parts, []
        return b"".join(parts)


class ArrowIpcEncoder:
    """Encodes record batches as an Arrow IPC stream, chunk by chunk."""

    def __init__(self, schema: pa.Schema) -> None:
        import pyarrow as pa

        self._sink = _Chunks()
        self._writer = pa.ipc.new_stream(self._sink, schema)

    def start(self) -> bytes:
        """The schema message."""
        return self._sink.drain()

    def batch(self, batch: pa.RecordBatch) -> bytes:
        self._writer.write_batch(batch)
        return self._sink.drain()

    def end(self) -> bytes:
        """The end-of-stream marker; without it a reader knows the stream broke off."""
        self._writer.close()
        return self._sink.drain()
