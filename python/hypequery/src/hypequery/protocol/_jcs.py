"""RFC 8785 serialization over an already validated plain-data tree."""

from __future__ import annotations

import math
import struct
from fractions import Fraction

from .errors import value_error

# All finite binary64 decimal exponents, plus guard room for interval scaling.
_POWERS_OF_TEN = {
    exponent: Fraction(10**exponent, 1) if exponent >= 0 else Fraction(1, 10 ** (-exponent))
    for exponent in range(-400, 401)
}


def _ceil(value: Fraction) -> int:
    return -((-value.numerator) // value.denominator)


def _lower_integer(value: Fraction, inclusive: bool) -> int:
    return _ceil(value) if inclusive else value.numerator // value.denominator + 1


def _upper_integer(value: Fraction, inclusive: bool) -> int:
    return value.numerator // value.denominator if inclusive else _ceil(value) - 1


def _round_ties_to_even(value: Fraction) -> int:
    quotient, remainder = divmod(value.numerator, value.denominator)
    doubled = remainder * 2
    if doubled < value.denominator:
        return quotient
    if doubled > value.denominator:
        return quotient + 1
    return quotient if quotient % 2 == 0 else quotient + 1


def _shortest_decimal(value: float) -> tuple[str, int]:
    """Return the ECMAScript shortest significand and its base-10 exponent.

    This is an exact-integer implementation of ECMA-262 Number::toString's
    shortest-round-trip selection rule. It deliberately does not use Python's
    ``repr``, ``str``, ``format``, or JSON encoder for float formatting.
    """

    exact = Fraction(*value.as_integer_ratio())
    previous_float = math.nextafter(value, -math.inf)
    next_float = math.nextafter(value, math.inf)
    previous = Fraction(*previous_float.as_integer_ratio())
    following = (
        exact + (exact - previous)
        if math.isinf(next_float)
        else Fraction(*next_float.as_integer_ratio())
    )
    lower = (exact + previous) / 2
    upper = (exact + following) / 2

    bits = struct.unpack(">Q", struct.pack(">d", value))[0]
    boundary_inclusive = bits & 1 == 0

    decimal_position = len(str(exact.numerator)) - len(str(exact.denominator)) + 1
    while exact < _POWERS_OF_TEN[decimal_position - 1]:
        decimal_position -= 1
    while exact >= _POWERS_OF_TEN[decimal_position]:
        decimal_position += 1

    for digits_count in range(1, 18):
        best: tuple[Fraction, int, int, int] | None = None
        for exponent in range(
            decimal_position - digits_count - 1,
            decimal_position - digits_count + 2,
        ):
            unit = _POWERS_OF_TEN[exponent]
            minimum = max(
                10 ** (digits_count - 1),
                _lower_integer(lower / unit, boundary_inclusive),
            )
            maximum = min(
                10**digits_count - 1,
                _upper_integer(upper / unit, boundary_inclusive),
            )
            if minimum > maximum:
                continue

            significand = min(maximum, max(minimum, _round_ties_to_even(exact / unit)))
            candidate = (
                abs(Fraction(significand) * unit - exact),
                significand % 2,
                significand,
                exponent,
            )
            if best is None or candidate < best:
                best = candidate

        if best is not None:
            return str(best[2]), best[3]

    raise AssertionError("every finite binary64 value has a <=17 digit representation")


def serialize_number(value: float) -> str:
    """Serialize one finite, non-negative-zero binary64 as ECMAScript JSON."""

    if not math.isfinite(value):
        value_error("HQ_VALUE_NON_FINITE_FLOAT")
    if value == 0:
        if math.copysign(1.0, value) < 0:
            value_error("HQ_VALUE_NEGATIVE_ZERO")
        return "0"

    sign = "-" if value < 0 else ""
    digits, exponent = _shortest_decimal(abs(value))
    digit_count = len(digits)
    decimal_position = digit_count + exponent

    if digit_count <= decimal_position <= 21:
        body = digits + "0" * (decimal_position - digit_count)
    elif 0 < decimal_position <= 21:
        body = f"{digits[:decimal_position]}.{digits[decimal_position:]}"
    elif -6 < decimal_position <= 0:
        body = f"0.{('0' * -decimal_position)}{digits}"
    else:
        scientific_exponent = decimal_position - 1
        mantissa = digits if digit_count == 1 else f"{digits[0]}.{digits[1:]}"
        exponent_sign = "+" if scientific_exponent >= 0 else ""
        body = f"{mantissa}e{exponent_sign}{scientific_exponent}"
    return sign + body


def _serialize_string(value: str) -> str:
    parts = ['"']
    short_escapes = {
        '"': '\\"',
        "\\": "\\\\",
        "\b": "\\b",
        "\f": "\\f",
        "\n": "\\n",
        "\r": "\\r",
        "\t": "\\t",
    }
    for character in value:
        escaped = short_escapes.get(character)
        if escaped is not None:
            parts.append(escaped)
        elif ord(character) <= 0x1F:
            parts.append(f"\\u{ord(character):04x}")
        else:
            parts.append(character)
    parts.append('"')
    return "".join(parts)


class _JcsWriter:
    def __init__(self, max_bytes: int) -> None:
        self.max_bytes = max_bytes
        self.byte_length = 0
        self.parts: list[str] = []

    def write(self, value: str) -> None:
        self.byte_length += len(value.encode("utf-8"))
        if self.byte_length > self.max_bytes:
            value_error("HQ_VALUE_TOO_LARGE")
        self.parts.append(value)

    def serialize(self, value: object) -> None:
        if value is None:
            self.write("null")
        elif type(value) is bool:
            self.write("true" if value else "false")
        elif type(value) is str:
            self.write(_serialize_string(value))
        elif type(value) is int:
            self.write(str(value))
        elif type(value) is float:
            self.write(serialize_number(value))
        elif type(value) is list:
            self.write("[")
            for index, item in enumerate(value):
                if index:
                    self.write(",")
                self.serialize(item)
            self.write("]")
        elif type(value) is dict:
            self.write("{")
            keys = sorted(value, key=lambda key: key.encode("utf-16-be"))
            for index, key in enumerate(keys):
                if index:
                    self.write(",")
                self.write(_serialize_string(key))
                self.write(":")
                self.serialize(value[key])
            self.write("}")
        else:
            value_error("HQ_VALUE_INVALID_FORMAT")


def serialize_jcs(value: object, *, max_bytes: int) -> str:
    """Serialize validated data while enforcing the canonical-byte budget."""

    writer = _JcsWriter(max_bytes)
    writer.serialize(value)
    return "".join(writer.parts)
