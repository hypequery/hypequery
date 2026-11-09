"""ClickHouse's in-band report of a query that failed after its result began.

Once the first bytes of a result are on the wire the HTTP status is fixed, so
ClickHouse 25.11 and later end the body with an exception block instead:

    \\r\\n__exception__\\r\\n<tag>\\r\\n<message>\\n<length> <tag>\\r\\n__exception__\\r\\n

and then reset the connection. A raw-bytes reader (one decoding Arrow itself)
must take that block off the end before decoding, or the decoder misreads the
message as data. The tag is random per query and appears at both ends, so a
block that names the same tag twice is ClickHouse's, without the response
header that announces it.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Final

#: How much of a body's end a reader holds back until the body is over. A
#: ClickHouse message runs to a few hundred bytes; a longer one still fails the
#: stream, without its text.
EXCEPTION_BLOCK_MAX_BYTES: Final = 16 * 1024

_OPEN = b"\r\n__exception__\r\n"
_BLOCK_END = re.compile(rb" ([A-Za-z0-9]+)\r\n__exception__\r\n\Z")


@dataclass(frozen=True, slots=True)
class StreamException:
    """The body before the exception block, and ClickHouse's message."""

    data: bytes
    message: str


def split_stream_exception(body: bytes, tag: str | None = None) -> StreamException | None:
    """Split a trailing exception block off *body*; ``None`` when there is none.

    With *tag* (the ``X-ClickHouse-Exception-Tag`` header) only that tag
    matches; without it the tag the block names at its end must also open it.
    A body that merely contains the marker is never mistaken for a failure.
    """

    end = _BLOCK_END.search(body)
    if end is None or (tag is not None and end.group(1).decode() != tag):
        return None
    opening = _OPEN + end.group(1) + b"\r\n"
    start = body.rfind(opening, 0, end.start())
    if start < 0:
        return StreamException(b"", "")
    text = body[start + len(opening) : end.start()].decode("utf-8", "replace")
    # "<message>\n<length>": the length hint follows the message's last newline.
    message, _, _ = text.rpartition("\n")
    return StreamException(body[:start], message.strip())


#: How far from a broken body's end an older server's message is looked for.
_LEGACY_TAIL_BYTES: Final = 2048


def legacy_stream_message(body: bytes) -> str | None:
    """The plain ``Code: ...`` text a server before 25.11 ends a failed body with.

    Only for a body already known to be broken (it failed to decode or the
    connection dropped): a well-formed one is never searched.
    """

    tail = body[-_LEGACY_TAIL_BYTES:]
    start = tail.rfind(b"Code: ")
    if start < 0:
        return None
    return tail[start:].decode("utf-8", "replace").strip()
