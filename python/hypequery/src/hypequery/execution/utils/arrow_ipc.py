"""Decode an Arrow IPC stream (ClickHouse ``ArrowStream``) as its bytes arrive.

pyarrow's stream reader pulls from a blocking file, which neither an async
response nor a body with ClickHouse's exception block on the end can be. This
decoder is fed chunks instead: it frames each IPC message from its prefix, so
a message is decoded once, when its last byte has arrived, and a failed query's
exception block is held back from it and reported as ClickHouse's error.
"""

from __future__ import annotations

import struct
from typing import TYPE_CHECKING, Any, Final

from hypequery.datasets.planner import CompiledQueryError

from ..errors import server_message_error
from .stream_exception import (
    EXCEPTION_BLOCK_MAX_BYTES,
    legacy_stream_message,
    split_stream_exception,
)

if TYPE_CHECKING:
    import pyarrow as pa

_CONTINUATION: Final = b"\xff\xff\xff\xff"
_END_OF_STREAM: Final = _CONTINUATION + b"\x00\x00\x00\x00"
#: The ``Message`` table's ``bodyLength`` field: version, header_type, header, bodyLength.
_BODY_LENGTH_FIELD: Final = 3


def require_pyarrow() -> Any:
    try:
        import pyarrow
    except ModuleNotFoundError as exc:
        raise ModuleNotFoundError(
            'streaming Arrow needs pyarrow. Install it with: pip install "hypequery[arrow]"'
        ) from exc
    return pyarrow


def _body_length(metadata: bytes) -> int:
    """``Message.bodyLength`` read from the flatbuffer, without a flatbuffers dependency."""

    (table,) = struct.unpack_from("<I", metadata, 0)
    (vtable_offset,) = struct.unpack_from("<i", metadata, table)
    vtable = table - vtable_offset
    (vtable_size,) = struct.unpack_from("<H", metadata, vtable)
    slot = 4 + 2 * _BODY_LENGTH_FIELD
    if slot + 2 > vtable_size:
        return 0
    (field,) = struct.unpack_from("<H", metadata, vtable + slot)
    if field == 0:
        return 0
    (length,) = struct.unpack_from("<q", metadata, table + field)
    return int(length)


class ArrowIpcDecoder:
    """Turns IPC stream bytes into the schema and record batches they hold."""

    def __init__(self, query_id: str, tag: str | None = None) -> None:
        self._pa = require_pyarrow()
        self._query_id = query_id
        self._tag = tag
        self._pending = bytearray()
        self._held = b""
        self.schema: pa.Schema | None = None
        self.ended = False

    def _invalid(self) -> CompiledQueryError:
        return CompiledQueryError("internal", "invalid result", query_id=self._query_id)

    def feed(self, chunk: bytes) -> list[pa.RecordBatch]:
        """The batches *chunk* completes; its last bytes are held until the body ends."""

        held = self._held + chunk
        release = len(held) - EXCEPTION_BLOCK_MAX_BYTES
        if release <= 0:
            self._held = held
            return []
        self._held = held[release:]
        return self._decode(held[:release])

    def finish(self) -> list[pa.RecordBatch]:
        """The batches left once the body ended; ClickHouse's error if it reported one."""

        failure = split_stream_exception(self._held, self._tag)
        if failure is not None:
            raise server_message_error(failure.message, self._query_id)
        tail = bytes(self._pending) + self._held
        try:
            batches = self._decode(self._held)
            self._held = b""
            if self._pending or self.schema is None:
                raise self._invalid()
        except CompiledQueryError:
            message = legacy_stream_message(tail)
            if message is not None:
                raise server_message_error(message, self._query_id) from None
            raise
        return batches

    def failed(self) -> CompiledQueryError | None:
        """ClickHouse's error when the body broke off after reporting one.

        ClickHouse resets the connection right after its exception block, so
        the reader fails with a transport error once the block is in. A server
        before 25.11 ends the body with plain message text instead.
        """

        failure = split_stream_exception(self._held, self._tag)
        if failure is not None:
            return server_message_error(failure.message, self._query_id)
        message = legacy_stream_message(bytes(self._pending) + self._held)
        return None if message is None else server_message_error(message, self._query_id)

    def _decode(self, data: bytes) -> list[pa.RecordBatch]:
        self._pending += data
        batches: list[pa.RecordBatch] = []
        offset = 0
        pending = self._pending
        while not self.ended and len(pending) - offset >= 8:
            if pending[offset : offset + 8] == _END_OF_STREAM:
                self.ended = True
                offset += 8
                break
            if pending[offset : offset + 4] != _CONTINUATION:
                raise self._invalid()
            (metadata_size,) = struct.unpack_from("<i", pending, offset + 4)
            if metadata_size <= 0 or len(pending) - offset < 8 + metadata_size:
                break
            metadata = bytes(pending[offset + 8 : offset + 8 + metadata_size])
            try:
                size = 8 + metadata_size + _body_length(metadata)
            except struct.error:
                raise self._invalid() from None
            if len(pending) - offset < size:
                break
            # A copy the batch can keep: batches reference their message's memory.
            message_bytes = bytes(pending[offset : offset + size])
            offset += size
            batches.extend(self._read(message_bytes))
        if self.ended and len(pending) > offset:
            raise self._invalid()
        del pending[:offset]
        return batches

    def _read(self, message_bytes: bytes) -> list[pa.RecordBatch]:
        pa = self._pa
        try:
            message = pa.ipc.read_message(pa.py_buffer(message_bytes))
            if self.schema is None:
                self.schema = pa.ipc.read_schema(message)
                return []
            return [pa.ipc.read_record_batch(message, self.schema)]
        except (pa.ArrowException, OSError, ValueError):
            raise self._invalid() from None
