"""JavaScript string semantics that Python does not share.

The reference implementation blank-tests trusted text with
``String.prototype.trim``. Python's ``str.strip`` is a different set: it strips
U+001C-U+001F and U+0085, which ``trim`` keeps, and keeps U+FEFF, which
``trim`` strips. Only the last of those diverges observably — the others are
rejected as control characters either way — but it diverges in the unsafe
direction: a byte-order mark alone passes ``strip`` and is accepted, while the
reference implementation rejects it as blank.
"""

from __future__ import annotations

#: ECMAScript `WhiteSpace` and `LineTerminator` outside General_Category Zs:
#: TAB, VT, FF, ZWNBSP, LF, CR, LINE SEPARATOR, PARAGRAPH SEPARATOR.
_JS_TRIM_NON_ZS = frozenset(map(chr, (0x09, 0x0B, 0x0C, 0xFEFF, 0x0A, 0x0D, 0x2028, 0x2029)))

#: General_Category Zs, spelled out rather than read from ``unicodedata`` so the
#: set is pinned to what ECMAScript defines rather than to the Unicode version
#: this interpreter happens to carry. U+2000-U+200A is one contiguous run.
_ZS = frozenset(map(chr, (0x20, 0xA0, 0x1680, 0x202F, 0x205F, 0x3000))) | frozenset(
    map(chr, range(0x2000, 0x200B))
)

_JS_TRIMMED = _JS_TRIM_NON_ZS | _ZS


def is_js_blank(value: str) -> bool:
    """Report whether ``String.prototype.trim`` would empty this string."""

    return all(character in _JS_TRIMMED for character in value)
