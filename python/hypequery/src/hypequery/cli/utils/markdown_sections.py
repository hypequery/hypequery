"""A Markdown document split at its ``## `` headings, to replace whole sections."""

from __future__ import annotations

import re
from itertools import pairwise

_HEADING = re.compile(r"^## (?P<title>.+)$", re.M)


def markdown_sections(document: str) -> list[tuple[str, str]]:
    """``(title, text)`` per ``## `` section, in order; joined, the texts are *document*.

    The text before the first heading has the title ``""``.
    """

    bounds = [0, *(match.start() for match in _HEADING.finditer(document)), len(document)]
    sections = []
    for start, end in pairwise(bounds):
        if start == end:
            continue
        text = document[start:end]
        heading = _HEADING.match(text)
        sections.append((heading["title"] if heading else "", text))
    return sections
