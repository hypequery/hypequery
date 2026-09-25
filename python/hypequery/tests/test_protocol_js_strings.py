"""Blank-text parity with `String.prototype.trim`.

Every protocol surface that carries trusted text rejects a blank value, and
"blank" is defined by the reference implementation's `trim`. Python's
`str.strip` is a different set, so these pin the cases where the two disagree —
the byte-order mark most of all, because there `strip` is the permissive one.
"""

from __future__ import annotations

import pytest

from hypequery.protocol import (
    ProtocolDeploymentError,
    ProtocolQueryImplementationError,
    validate_protocol_deployment_contract,
    validate_protocol_sql_expression,
)
from hypequery.protocol.js_strings import is_js_blank

#: Every code point `String.prototype.trim` removes: ECMAScript `WhiteSpace`,
#: `LineTerminator`, and General_Category Zs.
JS_TRIMMED = sorted(map(chr, (0x09, 0x0B, 0x0C, 0xFEFF, 0x0A, 0x0D, 0x2028, 0x2029))) + sorted(
    map(chr, (0x20, 0xA0, 0x1680, 0x202F, 0x205F, 0x3000, *range(0x2000, 0x200B)))
)

#: Code points ``str.strip`` removes but ``trim`` keeps (U+001C-U+001F, U+0085),
#: and near misses that neither removes (zero-width space, Mongolian vowel
#: separator). None of them may be treated as blank.
NOT_JS_TRIMMED = [*map(chr, (0x1C, 0x1D, 0x1E, 0x1F, 0x85, 0x200B, 0x180E)), "a"]


@pytest.mark.parametrize("character", JS_TRIMMED)
def test_trimmed_characters_are_blank(character: str) -> None:
    assert is_js_blank(character)
    assert is_js_blank(character * 3)


@pytest.mark.parametrize("character", NOT_JS_TRIMMED)
def test_untrimmed_characters_are_not_blank(character: str) -> None:
    assert not is_js_blank(character)


def test_the_empty_string_is_blank() -> None:
    assert is_js_blank("")


def test_a_byte_order_mark_is_not_a_sql_expression() -> None:
    # `str.strip` keeps U+FEFF, so before this rule Python accepted a SQL
    # fragment the reference implementation rejects as blank.
    with pytest.raises(ProtocolQueryImplementationError) as caught:
        validate_protocol_sql_expression(
            {
                "kind": "sql-expression",
                "dialect": "clickhouse",
                "sql": "﻿",
                "output": {"kind": "string"},
                "dependencies": [],
            }
        )
    assert caught.value.code == "HQ_QUERY_IMPLEMENTATION_INVALID_VALUE"


def test_a_byte_order_mark_is_not_a_deployment_description() -> None:
    with pytest.raises(ProtocolDeploymentError) as caught:
        validate_protocol_deployment_contract(
            {
                "kind": "hypequery-deployment",
                "version": 2,
                "datasets": [
                    {
                        "name": "orders",
                        "source": "orders",
                        "description": "\ufeff ",
                        "tenant": {"kind": "not-required"},
                        "dimensions": [],
                        "filters": [],
                        "relationships": [],
                        "measures": [
                            {
                                "name": "c",
                                "aggregation": "count",
                                "field": "id",
                                "filters": [],
                            }
                        ],
                    }
                ],
            }
        )
    assert caught.value.code == "HQ_DEPLOYMENT_INVALID_VALUE"


def test_a_byte_order_mark_inside_text_is_kept() -> None:
    expression = validate_protocol_sql_expression(
        {
            "kind": "sql-expression",
            "dialect": "clickhouse",
            "sql": "a﻿",
            "output": {"kind": "string"},
            "dependencies": [],
        }
    )
    assert expression.sql == "a﻿"
