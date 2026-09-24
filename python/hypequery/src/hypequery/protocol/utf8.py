"""UTF-8 length accounting that matches the JavaScript reference encoder.

Byte limits are part of the protocol, so Python and TypeScript must agree on
what "too long" means for every string either side can hold. Python strings
may contain unpaired UTF-16 surrogates that UTF-8 cannot encode at all, so
``str.encode`` is not usable here: it raises where ``TextEncoder`` silently
substitutes U+FFFD. This module reproduces the substitution instead.
"""

from __future__ import annotations


def exceeds_utf8_byte_limit(value: str, maximum: int) -> bool:
    """Return whether *value* encodes to more than *maximum* UTF-8 bytes.

    Each unpaired surrogate counts as the three bytes of U+FFFD, matching
    ``TextEncoder``. The scan stops as soon as the limit is passed, bounding
    the work a hostile in-memory input can force.
    """

    length = 0
    index = 0
    while index < len(value):
        code_point = ord(value[index])
        if code_point <= 0x7F:
            length += 1
        elif code_point <= 0x7FF:
            length += 2
        elif 0xD800 <= code_point <= 0xDBFF:
            if index + 1 < len(value) and 0xDC00 <= ord(value[index + 1]) <= 0xDFFF:
                length += 4
                index += 1
            else:
                length += 3
        elif 0xDC00 <= code_point <= 0xDFFF:
            length += 3
        elif code_point <= 0xFFFF:
            length += 3
        else:
            length += 4
        if length > maximum:
            return True
        index += 1
    return False
