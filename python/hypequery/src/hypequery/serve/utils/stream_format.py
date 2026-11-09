"""Which stream, if any, a dataset query request asks for."""

from __future__ import annotations

from typing import Final, Literal

#: Row batches, one JSON frame per line.
NDJSON_MEDIA_TYPE: Final = "application/x-ndjson"
#: An Arrow IPC stream.
ARROW_STREAM_MEDIA_TYPE: Final = "application/vnd.apache.arrow.stream"

StreamFormat = Literal["ndjson", "arrow"]

_FORMATS: Final[dict[str, StreamFormat]] = {
    NDJSON_MEDIA_TYPE: "ndjson",
    ARROW_STREAM_MEDIA_TYPE: "arrow",
}


def requested_stream_format(accept: str | None) -> StreamFormat | None:
    """The first acceptable stream type *accept* lists; ``q=0`` refuses one."""

    if not accept:
        return None
    for media_range in accept.split(","):
        kind, *params = (part.strip() for part in media_range.strip().lower().split(";"))
        found = _FORMATS.get(kind)
        if found is None:
            continue
        if any(param.replace(" ", "") in ("q=0", "q=0.0", "q=0.00", "q=0.000") for param in params):
            continue
        return found
    return None
