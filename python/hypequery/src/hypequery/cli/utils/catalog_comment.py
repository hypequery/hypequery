"""Turn a ClickHouse ``COMMENT`` into a description the deployment contract accepts.

A contract description is non-blank, has no C0 or C1 control characters (so no
newline or tab), and fits 4096 UTF-8 bytes. A catalog comment may be any of
those, so whitespace runs become one space, other controls are dropped, and an
over-long comment is shortened on a character boundary. A comment the contract
would read as blank, judged by JavaScript's ``trim`` (which, unlike Python's
``strip``, removes U+FEFF), gives no description.
"""

from __future__ import annotations

import re

from hypequery.protocol.js_strings import is_js_blank

#: The deployment contract's ``max_text_bytes``.
MAX_DESCRIPTION_BYTES = 4_096
_ELLIPSIS = "…"
_WHITESPACE = re.compile(r"\s+")
_CONTROL = re.compile(r"[\x00-\x1f\x7f-\x9f]")


def description_from_comment(comment: str) -> tuple[str, bool]:
    """The description for *comment*, and whether it had to be shortened."""

    text = _CONTROL.sub("", _WHITESPACE.sub(" ", comment)).strip()
    if is_js_blank(text):
        return "", False
    encoded = text.encode("utf-8")
    if len(encoded) <= MAX_DESCRIPTION_BYTES:
        return text, False
    budget = MAX_DESCRIPTION_BYTES - len(_ELLIPSIS.encode("utf-8"))
    shortened = encoded[:budget].decode("utf-8", errors="ignore").rstrip()
    return shortened + _ELLIPSIS, True
